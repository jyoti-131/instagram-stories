/**
 * Instagram Stories — Pure vanilla JS, zero external libs
 * Fixed: image visibility, close button, smooth crossfade transitions
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const STORY_DURATION  = 5000;  // ms per story
const TRANSITION_MS   = 320;   // crossfade duration

// ─── State ───────────────────────────────────────────────────────────────────
let stories        = [];
let currentIndex   = 0;
let isPaused       = false;
let isTransitioning= false;
let timer          = null;
let timerStart     = null;
let timerRemaining = STORY_DURATION;
let progressAnim   = null;
let seenSet        = new Set();

// ─── DOM refs ────────────────────────────────────────────────────────────────
const storiesStrip   = document.getElementById('storiesStrip');
const storyViewer    = document.getElementById('storyViewer');
const progressBars   = document.getElementById('progressBars');
const viewerAvatar   = document.getElementById('viewerAvatar');
const viewerUsername = document.getElementById('viewerUsername');
const viewerTime     = document.getElementById('viewerTime');
const storyImageWrap = document.getElementById('storyImageWrap');
const storyImage     = document.getElementById('storyImage');
const storyLoading   = document.getElementById('storyLoading');
const tapLeft        = document.getElementById('tapLeft');
const tapRight       = document.getElementById('tapRight');
const pauseBtn       = document.getElementById('pauseBtn');
const pauseIcon      = document.getElementById('pauseIcon');
const playIcon       = document.getElementById('playIcon');
const closeBtn       = document.getElementById('closeBtn');

// ─── Fetch stories ────────────────────────────────────────────────────────────
async function fetchStories() {
  try {
    const res = await fetch('./stories.json');
    if (!res.ok) throw new Error('Failed to load stories.json');
    stories = await res.json();
    renderStrip();
  } catch (err) {
    console.error(err);
    storiesStrip.innerHTML =
      '<p style="color:rgba(255,255,255,.4);font-size:12px;padding:10px">Could not load stories.</p>';
  }
}

// ─── Render strip ────────────────────────────────────────────────────────────
function renderStrip() {
  storiesStrip.innerHTML = '';
  stories.forEach((story, idx) => {
    const item = document.createElement('div');
    item.className = 'story-item';
    item.dataset.idx = idx;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `View ${story.username}'s story`);
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="story-ring">
        <div class="story-ring-inner">
          <img class="story-thumb" src="${story.avatar}" alt="${story.username}" loading="lazy" />
        </div>
      </div>
      <span class="story-username">${story.username}</span>
    `;
    item.addEventListener('click',   () => openViewer(idx));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openViewer(idx);
    });
    storiesStrip.appendChild(item);
  });
}

// ─── Mark seen ───────────────────────────────────────────────────────────────
function markSeen(idx) {
  seenSet.add(idx);
  storiesStrip.querySelector(`[data-idx="${idx}"]`)?.classList.add('seen');
}

// ─── Progress bars ───────────────────────────────────────────────────────────
function buildProgressBars() {
  progressBars.innerHTML = '';
  stories.forEach((_, i) => {
    const seg  = document.createElement('div');
    seg.className = 'progress-seg';
    const fill = document.createElement('div');
    fill.className = 'progress-fill' + (i < currentIndex ? ' done' : '');
    seg.appendChild(fill);
    progressBars.appendChild(seg);
  });
}

function getFill(idx) {
  return progressBars.children[idx]?.querySelector('.progress-fill');
}

function startProgressAnimation(duration) {
  cancelAnimationFrame(progressAnim);
  const fill  = getFill(currentIndex);
  if (!fill) return;
  const start = performance.now();

  function tick(now) {
    if (isPaused) return;
    const pct = Math.min(((now - start) / duration) * 100, 100);
    fill.style.width = pct + '%';
    if (pct < 100) progressAnim = requestAnimationFrame(tick);
  }
  progressAnim = requestAnimationFrame(tick);
}

function pauseProgressAnimation() { cancelAnimationFrame(progressAnim); }

// ─── Timer ───────────────────────────────────────────────────────────────────
function startTimer(duration) {
  clearTimeout(timer);
  timerStart     = performance.now();
  timerRemaining = duration;
  timer = setTimeout(() => advanceStory(1), duration);
  startProgressAnimation(duration);
}

function pauseTimer() {
  if (!timerStart) return;
  clearTimeout(timer);
  pauseProgressAnimation();
  timerRemaining -= (performance.now() - timerStart);
  timerStart = null;
}

function resumeTimer() {
  if (timerRemaining <= 0) { advanceStory(1); return; }
  timerStart = performance.now();
  timer = setTimeout(() => advanceStory(1), timerRemaining);
  startProgressAnimation(timerRemaining);
}

// ─── Open / Close viewer ─────────────────────────────────────────────────────
function openViewer(idx) {
  currentIndex = idx;
  storyViewer.setAttribute('aria-hidden', 'false');
  storyViewer.classList.add('open');
  document.body.style.overflow = 'hidden';
  loadStory(idx, null);
}

function closeViewer() {
  clearTimeout(timer);
  cancelAnimationFrame(progressAnim);
  isTransitioning = false;
  isPaused        = false;
  storyViewer.classList.remove('open');
  storyViewer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setPauseUI(false);
  // Clean up any leftover incoming slide
  const incoming = storyImageWrap.querySelector('.story-image-incoming');
  if (incoming) incoming.remove();
}

// ─── FIX 3: Smooth crossfade transition between stories ──────────────────────
// Instead of mutating one <img>, we create a second img on top, fade it in,
// then swap and remove the old one. Zero flicker, buttery smooth.
function crossfadeToImage(newSrc, direction, onReady) {
  // Create the incoming image layer
  const incoming = document.createElement('img');
  incoming.className = 'story-image story-image-incoming';
  incoming.style.cssText = `
    position:absolute; inset:0;
    width:100%; height:100%;
    object-fit:cover;
    opacity:0;
    z-index:3;
    transform: translateX(${direction === 1 ? '6%' : direction === -1 ? '-6%' : '0'});
    transition: opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms cubic-bezier(0.25,0.46,0.45,0.94);
  `;

  storyImageWrap.appendChild(incoming);

  // Show spinner while loading
  storyLoading.classList.remove('hidden');

  incoming.onload = () => {
    storyLoading.classList.add('hidden');

    // Trigger reflow so transition fires
    incoming.getBoundingClientRect();

    // Animate in: fade + slight slide
    incoming.style.opacity   = '1';
    incoming.style.transform = 'translateX(0)';

    // Simultaneously fade out the old image
    storyImage.style.transition = `opacity ${TRANSITION_MS}ms ease`;
    storyImage.style.opacity    = '0';

    setTimeout(() => {
      // Promote incoming to be the main image
      storyImage.src              = incoming.src;
      storyImage.style.opacity    = '1';
      storyImage.style.transition = '';
      incoming.remove();
      onReady();
    }, TRANSITION_MS);
  };

  incoming.onerror = () => {
    storyLoading.classList.add('hidden');
    incoming.remove();
    // Still show something even if image 404s
    storyImage.style.opacity = '1';
    onReady();
  };

  incoming.src = newSrc;
}

// ─── Load a story ─────────────────────────────────────────────────────────────
function loadStory(idx, direction) {
  if (idx < 0 || idx >= stories.length) { closeViewer(); return; }
  if (isTransitioning) return;

  isTransitioning = true;
  const story = stories[idx];

  clearTimeout(timer);
  cancelAnimationFrame(progressAnim);

  // Reset pause
  isPaused = false;
  setPauseUI(false);

  // Progress bars
  buildProgressBars();

  // Topbar
  viewerAvatar.src             = story.avatar;
  viewerUsername.textContent   = story.username;
  viewerTime.textContent       = story.timestamp;

  crossfadeToImage(story.image, direction, () => {
    isTransitioning = false;
    startTimer(STORY_DURATION);
    markSeen(idx);
  });
}

// ─── Advance ─────────────────────────────────────────────────────────────────
function advanceStory(dir) {
  const next = currentIndex + dir;
  if (next >= stories.length || next < 0) { closeViewer(); return; }
  currentIndex = next;
  loadStory(currentIndex, dir);
}

// ─── Pause UI helper ─────────────────────────────────────────────────────────
function setPauseUI(paused) {
  pauseIcon.style.display = paused ? 'none' : '';
  playIcon.style.display  = paused ? ''     : 'none';
}

// ─── Toggle pause ────────────────────────────────────────────────────────────
function togglePause() {
  if (isPaused) {
    isPaused = false;
    setPauseUI(false);
    resumeTimer();
  } else {
    isPaused = true;
    setPauseUI(true);
    pauseTimer();
  }
}

// ─── Long-press to pause (only on image, NOT on controls) ────────────────────
let longPressTimer   = null;
let longPressActive  = false;

function handlePointerDown(e) {
  // Don't intercept taps on buttons
  if (e.target.closest('button, .tap-zone, .viewer-bottom')) return;
  longPressActive = false;
  longPressTimer  = setTimeout(() => {
    longPressActive = true;
    if (!isPaused) {
      isPaused = true;
      setPauseUI(true);
      pauseTimer();
    }
  }, 250);
}

function handlePointerUp(e) {
  clearTimeout(longPressTimer);
  if (longPressActive && isPaused) {
    longPressActive = false;
    isPaused        = false;
    setPauseUI(false);
    resumeTimer();
  }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

// FIX 2: Close button — stopPropagation so parent pointer events don't swallow it
closeBtn.addEventListener('pointerdown', e => e.stopPropagation());
closeBtn.addEventListener('click', e => {
  e.stopPropagation();
  closeViewer();
});

// Pause button — same fix
pauseBtn.addEventListener('pointerdown', e => e.stopPropagation());
pauseBtn.addEventListener('click', e => {
  e.stopPropagation();
  togglePause();
});

// Tap zones — navigate
tapLeft.addEventListener('click',  () => { if (!isTransitioning) advanceStory(-1); });
tapRight.addEventListener('click', () => { if (!isTransitioning) advanceStory(1);  });

// Long-press on the image wrap (but not controls)
storyImageWrap.addEventListener('pointerdown', handlePointerDown);
storyImageWrap.addEventListener('pointerup',   handlePointerUp);
storyImageWrap.addEventListener('pointercancel', handlePointerUp);
storyImageWrap.addEventListener('pointerleave',  handlePointerUp);

// Keyboard
document.addEventListener('keydown', e => {
  if (!storyViewer.classList.contains('open')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); advanceStory(1);  }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); advanceStory(-1); }
  if (e.key === 'Escape')     { e.preventDefault(); closeViewer();    }
  if (e.key === ' ')          { e.preventDefault(); togglePause();    }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
fetchStories();
