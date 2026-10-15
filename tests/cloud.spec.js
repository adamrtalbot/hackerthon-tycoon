import { test, expect } from '@playwright/test';

const openCloud = async page => {
  await page.locator('[data-cloud="open"]:visible').last().click();
  await expect(page.locator('#cloud')).toHaveAttribute('aria-busy', 'false');
};

test('save, reload and recover on another device preserve pending decisions and timed effects', async ({ page, browser }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // Fixed inputs at simulation boundaries make a resumed run comparable to uninterrupted play.
  const before = await page.evaluate(() => {
    newGame(42);gameAction('start');
    gameAction('build','pizza');gameAction('map','[2.5,4.5]');gameAction('cancel');
    for(let i=0;i<920;i++)advanceGame();
    gameAction('sl',`${S.prs[0].msg}:1`); // A revised PR will arrive 12 seconds later.
    gameAction('speed','0');gameAction('tab','slack');
    return {score:score(),credits:S.credits,clock:clockStr(),messages:S.slack.map(m=>m.text)};
  });
  await openCloud(page);
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('Saved day 1');
  const code = await page.locator('#recovery-code').inputValue();
  const continuation = () => {
    const event=S.slack.find(m=>m.actions&&!m.done&&!m.noAuto);
    if(event)gameAction('sl',`${event.id}:0`);
    for(let i=0;i<400;i++)advanceGame();
    gameAction('speed','0');
    return {score:score(),credits:S.credits,clock:clockStr(),messages:S.slack.map(m=>m.text),modules:[...S.mods],prs:S.prs.map(p=>({mod:p.mod,notes:p.notes})),objects:S.objs.map(o=>({type:o.type,c:o.c,r:o.r}))};
  };
  const uninterrupted = await page.evaluate(continuation);
  await page.reload();
  await openCloud(page);
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText(`Loaded day 1, ${before.clock}`);
  expect(await page.evaluate(() => ({score:score(),credits:S.credits,clock:clockStr(),messages:S.slack.map(m=>m.text)}))).toEqual(before);
  expect(await page.evaluate(continuation)).toEqual(uninterrupted);

  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto('/');
    await openCloud(second);
    await expect(second.locator('#cloud-status')).toContainText('No cloud save yet');
    await second.locator('#recovery-details summary').click();
    await second.getByLabel('Use a code from another device').fill(code);
    await second.getByRole('button', { name: 'Connect saved game' }).click();
    await expect(second.locator('#cloud-status')).toContainText(`Loaded day 1, ${before.clock}`);
    expect(await second.evaluate(continuation)).toEqual(uninterrupted);
    await second.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(second.locator('#cloud-status')).toContainText('Saved day 1');
    // The first device still holds the older revision; it must not overwrite the second.
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.locator('#cloud-status')).toContainText('cloud save changed');
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});

test('day boundaries and completed games survive saves; public scores render as text', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    newGame(103);gameAction('start');
    while(!S.paused)advanceGame();
    const daySave=exportReplay(),dayScore=score(),dayCredits=S.credits;
    restoreReplay(daySave);
    const restored={score:score(),credits:S.credits,day:S.day};
    gameAction('nextday');
    for(let i=0;i<20000&&!S.over;i++){
      if(S.paused)gameAction('nextday');
      advanceGame();
    }
    const final=exportReplay(),total=score(),day=S.day;
    restoreReplay(final);
    return {dayScore,dayCredits,restored,total,day,restoredTotal:score(),over:S.over};
  });
  expect(result.restored).toEqual({score:result.dayScore,credits:result.dayCredits,day:1});
  expect(result.over).toBe(true);
  expect(result.restoredTotal).toBe(result.total);
  await expect(page.locator('#overlay')).toContainText('Run another hackathon');
  await openCloud(page);
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText(`Saved day ${result.day}`);
  await page.reload();
  await openCloud(page);
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('view your results or start a new hackathon');
  await page.getByLabel('Public player name').fill('<b>pipeline_pioneer</b>');
  await page.getByRole('button', { name: 'Submit finished game' }).click();
  await expect(page.locator('#score-status')).toContainText('Score submitted');
  const row=page.locator('#leaderboard tr').filter({hasText:'<b>pipeline_pioneer</b>'});
  await expect(row).toContainText(result.total.toLocaleString());
  await expect(row.locator('b')).toHaveCount(0);
});

test('failed requests and incompatible saves keep the current game; dialog traps keyboard input', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button', { name: 'Start the hackathon', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await openCloud(page);
  await page.locator('#recovery-details summary').click();
  await expect(page.locator('#recovery-code')).toHaveAttribute('type','password');
  expect(await page.locator('#recover-code').evaluate(el=>el.getBoundingClientRect().right<=el.closest('.card').getBoundingClientRect().right)).toBe(true);
  await page.getByRole('button',{name:'Connect saved game'}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Connect saved game'})).toBeInViewport();
  await page.locator('#recovery-details summary').click();
  const before=await page.evaluate(()=>({credits:S.credits,stars:S.stars,steps:replay.steps}));
  await page.getByLabel('Public player name').pressSequentially('resumeharshilhackathon');
  expect(await page.evaluate(()=>({credits:S.credits,stars:S.stars,steps:replay.steps}))).toEqual(before);
  await page.route('**/api/save', route=>route.abort());
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('Your current game is still here');
  await page.unroute('**/api/save');
  await page.route('**/api/save', route=>route.fulfill({json:{revision:1,save:{version:99}}}));
  page.on('dialog', dialog=>dialog.accept());
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('unsupported game version');
  expect(await page.evaluate(()=>({credits:S.credits,stars:S.stars,steps:replay.steps}))).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('#cloud')).not.toBeVisible();
  expect(await page.evaluate(()=>S.paused)).toBe(true);
});

test('changing recovery identity in another tab blocks writes until explicitly reconciled', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => { newGame(12);gameAction('start');gameAction('speed','0'); });
  await openCloud(page);
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(page.locator('#cloud-status')).toContainText('Saved day 1');
  const originalCode = await page.locator('#recovery-code').inputValue();
  const second = await context.newPage();
  await second.goto('/');
  await openCloud(second);
  await second.getByRole('button', { name: 'Load game', exact: true }).click();
  await expect(second.locator('#cloud-status')).toContainText('Loaded day 1');
  const before = await second.evaluate(() => exportReplay());
  const otherCode = 'b'.repeat(64);
  const otherSave = { version: 1, seed: 20, steps: 0, commands: [] };
  expect((await context.request.put('/api/save', {
    headers: { Authorization: `Bearer ${otherCode}` }, data: { revision: 0, save: otherSave },
  })).ok()).toBe(true);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#recovery-details summary').click();
  await page.getByLabel('Use a code from another device').fill(otherCode);
  await page.getByRole('button', { name: 'Connect saved game' }).click();
  await expect(page.locator('#cloud-status')).toContainText('Loaded day 1');
  await expect(second.locator('#identity-conflict')).toBeVisible();
  await second.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(second.locator('#cloud-status')).toContainText('Recovery code changed');
  expect(await second.locator('#recovery-code').inputValue()).toBe(originalCode);
  expect(await second.evaluate(() => exportReplay())).toEqual(before);
  const saved = async code => (await context.request.get('/api/save', { headers: { Authorization: `Bearer ${code}` } })).json();
  expect((await saved(originalCode)).revision).toBe(1);
  expect((await saved(otherCode)).save).toEqual(otherSave);

  await second.getByRole('button', { name: 'Keep this tab’s code' }).click();
  await expect(second.locator('#identity-conflict')).not.toBeVisible();
  await second.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(second.locator('#cloud-status')).toContainText('Saved day 1');
  expect((await saved(originalCode)).revision).toBe(2);
  await expect(page.locator('#identity-conflict')).toBeVisible();

  // A write already in flight may finish, but must not hide the identity warning.
  await second.route('**/api/save', async route => {
    await page.evaluate(code => localStorage.setItem('nfcore-hackathon-cloud-code', code), otherCode);
    await route.continue();
  }, { times: 1 });
  await second.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(second.locator('#cloud-status')).toContainText('Saved day 1');
  await expect(second.locator('#identity-conflict')).toBeVisible();
  expect((await saved(originalCode)).revision).toBe(3);
  await second.getByRole('button', { name: 'Keep this tab’s code' }).click();

  // A pre-write check also protects against a storage event that has not arrived.
  await second.evaluate(code => localStorage.setItem('nfcore-hackathon-cloud-code', code), otherCode);
  await second.getByRole('button', { name: 'Save game', exact: true }).click();
  await expect(second.locator('#cloud-status')).toContainText('Recovery code changed');
  expect((await saved(originalCode)).revision).toBe(3);
  await second.evaluate(() => {
    newGame(103);gameAction('start');
    for(let i=0;i<20000&&!S.over;i++){if(S.paused)gameAction('nextday');advanceGame();}
  });
  await second.getByRole('button', { name: 'Refresh', exact: true }).click();
  await second.getByLabel('Public player name').fill('blocked-score');
  await second.getByRole('button', { name: 'Submit finished game' }).click();
  await expect(second.locator('#score-status')).toContainText('Recovery code changed');
  const board = await (await context.request.get('/api/leaderboard')).json();
  expect(board.entries.some(entry => entry.name === 'blocked-score')).toBe(false);
  await second.close();
});

test('placement feedback survives HUD refreshes and clears for the next placement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { gameAction('start');gameAction('speed','0'); });
  await page.getByRole('button', { name: /Pizza table/ }).click();
  const tile = await page.evaluate(() => T);
  await page.locator('#map').click({ position: { x: 3.5 * tile, y: 8.5 * tile } });
  await expect(page.locator('#modetext')).toHaveText('Cannot build there. Keep walkways open.');
  // The HUD refreshes every 350ms; the error must outlast those refreshes.
  await page.waitForTimeout(600);
  await expect(page.locator('#modetext')).toHaveText('Cannot build there. Keep walkways open.');
  await expect(page.locator('#modetext')).toContainText('Placing Pizza table');
  await page.locator('#map').click({ position: { x: 2.5 * tile, y: 4.5 * tile } });
  await expect(page.locator('#modetext')).toContainText('Placing Pizza table');
  expect(await page.evaluate(() => S.objs.filter(o => o.type === 'pizza').length)).toBe(1);
});
