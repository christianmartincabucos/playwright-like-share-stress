function makeAccessibleLocator(page, role, namePattern) {
  return page.getByRole(role, { name: namePattern });
}

async function countMatches(locator) {
  try { return await locator.count(); } catch (_) { return 0; }
}

async function describeElement(locator) {
  return locator.evaluate(element => ({
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    type: element.getAttribute('type'),
    ariaLabel: element.getAttribute('aria-label'),
    ariaPressed: element.getAttribute('aria-pressed'),
    ariaChecked: element.getAttribute('aria-checked'),
    ariaExpanded: element.getAttribute('aria-expanded'),
    dataState: element.getAttribute('data-state'),
    dataLiked: element.getAttribute('data-liked'),
    title: element.getAttribute('title'),
    href: element.getAttribute('href'),
    target: element.getAttribute('target'),
    disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
    text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180)
  }));
}

async function findUniqueControl(page, role, pattern, label) {
  const locator = makeAccessibleLocator(page, role, pattern);
  const count = await countMatches(locator);
  if (count === 0) return { found: false, count, locator: null, detail: null, reason: `${label} ${role} not found by accessible name.` };
  if (count !== 1) return { found: false, count, locator: null, detail: null, reason: `Ambiguous ${label} ${role}: found ${count} matches.` };
  const detail = await describeElement(locator);
  return { found: true, count, locator, detail, reason: null };
}

async function inspectPage(page) {
  const likeButton = await findUniqueControl(page, 'button', /^like(?:\b|$)/i, 'Like');
  const likeLink = await findUniqueControl(page, 'link', /^like(?:\b|$)/i, 'Like');
  const shareButton = await findUniqueControl(page, 'button', /^share(?:\b|$)/i, 'Share');
  const commentButton = await findUniqueControl(page, 'button', /^comment(?:s)?(?:\b|$)/i, 'Comment');
  const commentLink = await findUniqueControl(page, 'link', /^comment(?:s)?(?:\b|$)/i, 'Comment');

  const inventory = await page.locator('button, a, [role="button"], [role="link"]').evaluateAll(elements => elements.slice(0, 100).map(element => ({
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label'),
    text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    href: element.getAttribute('href'),
    disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true'
  })));

  let like = likeButton.found ? likeButton : likeLink;
  let likeDisposition;
  if (!like.found) {
    likeDisposition = { runnable: false, mode: 'unavailable', reason: likeButton.reason || likeLink.reason || 'No unique accessible Like control was found.' };
  } else if (like.detail.tagName !== 'button' && like.detail.role !== 'button') {
    const href = like.detail.href ? new URL(like.detail.href, page.url()) : null;
    likeDisposition = href
      ? {
          runnable: true,
          mode: 'external-link',
          destination: href.href,
          reason: `Like is a link to ${href.origin}; the test will click it, close the destination tab (or go back if it replaces this tab), and return to the dashboard. This tests link navigation, not a Like action on YouTube.`
        }
      : { runnable: false, mode: 'unavailable', reason: 'Like is exposed as a link without a valid destination URL.' };
  } else {
    const initialState = readLikeState(like.detail);
    likeDisposition = initialState === null
      ? { runnable: false, mode: 'unavailable', reason: 'Like button has no detectable pressed/liked state; a toggle cannot be verified safely.' }
      : { runnable: true, mode: 'toggle-button', reason: null, initialState };
  }

  const shareDisposition = shareButton.found
    ? { runnable: true, reason: null }
    : { runnable: false, reason: shareButton.reason || 'No unique accessible Share button was found.' };

  // Comment: prefer a button, fall back to a link (same pattern as Like).
  const comment = commentButton.found ? commentButton : commentLink;
  let commentDisposition;
  if (!comment.found) {
    commentDisposition = {
      runnable: false,
      mode: 'unavailable',
      reason: commentButton.reason || commentLink.reason || 'No unique accessible Comment control was found.'
    };
  } else if (comment.detail.tagName !== 'button' && comment.detail.role !== 'button') {
    const href = comment.detail.href ? new URL(comment.detail.href, page.url()) : null;
    commentDisposition = href
      ? {
          runnable: true,
          mode: 'external-link',
          destination: href.href,
          reason: `Comment is a link to ${href.origin}; the test will click it, close the destination tab (or go back), and return to the dashboard.`
        }
      : { runnable: false, mode: 'unavailable', reason: 'Comment is exposed as a link without a valid destination URL.' };
  } else {
    commentDisposition = { runnable: true, mode: 'button', reason: null };
  }

  return {
    inspectedAt: new Date().toISOString(),
    url: page.url(),
    title: await page.title().catch(() => null),
    like: { button: likeButton.detail, link: likeLink.detail, selected: like.detail || null, disposition: likeDisposition },
    share: { button: shareButton.detail, disposition: shareDisposition },
    comment: { button: commentButton.detail, link: commentLink.detail, selected: comment.detail || null, disposition: commentDisposition },
    candidateInventory: inventory
  };
}
function readLikeState(snapshot) {
  if (!snapshot) return null;
  if (snapshot.ariaPressed === 'true' || snapshot.ariaPressed === 'false') return `pressed:${snapshot.ariaPressed}`;
  if (snapshot.ariaChecked === 'true' || snapshot.ariaChecked === 'false') return `checked:${snapshot.ariaChecked}`;
  if (snapshot.dataLiked === 'true' || snapshot.dataLiked === 'false') return `liked:${snapshot.dataLiked}`;
  if (snapshot.dataState && /^(on|off|active|inactive|liked|unliked)$/i.test(snapshot.dataState)) return `state:${snapshot.dataState.toLowerCase()}`;
  const label = `${snapshot.ariaLabel || ''} ${snapshot.title || ''} ${snapshot.text || ''}`.trim().toLowerCase();
  if (/\bunlike\b|\bliked\b/.test(label)) return 'label:liked';
  if (/^like\b|\blike this\b/.test(label)) return 'label:unliked';
  return null;
}

async function resolveLikeButton(page) {
  const result = await findUniqueControl(page, 'button', /^like(?:\b|$)/i, 'Like');
  return result.found ? result : null;
}

async function resolveShareButton(page) {
  const result = await findUniqueControl(page, 'button', /^share(?:\b|$)/i, 'Share');
  return result.found ? result : null;
}

async function resolveCommentButton(page) {
  // Try button first; fall back to link (the page may expose Comment as an <a>).
  const btn = await findUniqueControl(page, 'button', /^comment(?:s)?(?:\b|$)/i, 'Comment');
  if (btn.found) return btn;
  const lnk = await findUniqueControl(page, 'link', /^comment(?:s)?(?:\b|$)/i, 'Comment');
  return lnk.found ? lnk : null;
}

module.exports = { inspectPage, readLikeState, resolveLikeButton, resolveShareButton, resolveCommentButton, describeElement };
