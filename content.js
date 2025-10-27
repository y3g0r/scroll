(function() {
    if (window.scrollRunning) {
        return
    }
    window.scrollRunning = true

    // Cross-browser compatibility
    const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

    const DIVIDING_LINE_HEIGHT = 1
    const DEFAULT_DELTA = 1
    const NORMAL_SCROLL_INTERVAL = 80
    let NEXT_PAGE_DOC_SHIFT = 0
    // these to are using constants naming conv, b/c I don't handle window resize during reading right now
    let CANVAS_WIDTH = 0
    let CANVAS_HEIGHT = 0
    // document will be drawn starting from this y position
    let documentOffset = 0
    // where in the canvas new content will be drawn
    let canvasOffset = 0
    let scrollDownInterval = null
    let canvas = null
    let drawingCtx = null
    let readStartYOffset = 0
    let initialUserScrollY = 0  // User's scroll position when extension was activated
    let scrollInterval = NORMAL_SCROLL_INTERVAL
    let timePerScreen = 30 // Default: 30 seconds per screen
    let speedMultiplier = 1 // 1 = normal speed, 3 = slow speed (for space key toggle)
    let isCapturing = false // Prevent concurrent captures
    let isBatchCapturing = false // Batch capture in progress

    // Convert time-per-screen to scroll interval based on screen height
    function calculateScrollInterval() {
        const screenHeight = CANVAS_HEIGHT || window.innerHeight || 800;
        // timePerScreen is in seconds, scrollInterval is in ms
        // We scroll 1 pixel (DEFAULT_DELTA) per interval
        // So: screenHeight pixels / (timePerScreen * 1000 ms) = pixels per ms
        // Therefore: scrollInterval = (timePerScreen * 1000) / screenHeight
        // Apply speed multiplier for temporary speed changes (space key)
        return Math.max(10, Math.floor((timePerScreen * speedMultiplier * 1000) / screenHeight));
    }

    // Load saved scroll speed from storage
    browserAPI.storage.sync.get(['timePerScreen']).then((result) => {
        if (result.timePerScreen) {
            timePerScreen = result.timePerScreen;
            scrollInterval = calculateScrollInterval();
        }
    }).catch((error) => {
        console.error('Failed to load scroll speed:', error);
    });

    // Performance optimization: cache captured screens
    let capturedScreensCache = new Map() // Map of scrollY -> Image
    let cachedDimensions = { width: 0, height: 0 } // Dimensions used for cache
    let nextCaptureY = 0 // Next position to capture
    const CACHE_AHEAD_SCREENS = 5 // How many screens to keep cached ahead
    const CACHE_TRIGGER_SCREENS = 2 // When to trigger batch capture

    /* Feature detection */
    let passiveSupported = false;

    try {
        const options = {
            get passive() { // This function will be called when the browser
                //   attempts to access the passive property.
                passiveSupported = true;
                return false;
            }
        };

        window.addEventListener("test", null, options);
        window.removeEventListener("test", null, options);
    } catch(err) {
        passiveSupported = false;
    }

    /* Touch support for mobile devices */
    let touchStartY = 0;
    let touchStartX = 0;
    let touchStartTime = 0;
    let lastTouchY = 0;
    let lastTouchTime = 0;
    let touchVelocity = 0; // pixels per millisecond
    let wasPausedByTouch = false; // Track if we paused due to touch-and-hold
    let hasMovedSignificantly = false; // Track if touch has moved enough to be a drag
    const TAP_THRESHOLD_MS = 200; // Max duration for a tap
    const MOVEMENT_THRESHOLD = 10; // Min pixels to consider it a drag
    const SIGNIFICANT_UP_SCROLL = 3; // Threshold for pausing auto-scroll on up gesture
    // Momentum calculation parameters
    // Momentum is the "coasting" effect after finger lifts - based only on final velocity
    const MOMENTUM_BASE_MULTIPLIER = 150; // Base multiplier for velocity
    const MOMENTUM_VELOCITY_POWER = 1.8; // Non-linear scaling (fast flicks scroll much further)

    /**
     * Capture a full viewport screenshot and cache it with retry logic
     */
    async function captureScreen(scrollY, skipRestore = false, retryCount = 0, maxRetries = 5) {
        if (isCapturing) {
            console.log('[Scroll] Skipping capture, already in progress');
            return null;
        }

        // Check if already cached
        if (capturedScreensCache.has(scrollY)) {
            console.log('[Scroll] Using cached screen for scrollY:', scrollY);
            return capturedScreensCache.get(scrollY);
        }

        isCapturing = true;
        console.log('[Scroll] Starting capture for scrollY:', scrollY);
        try {
            // Save current scroll position (only if not batch capturing)
            const currentScrollY = window.scrollY;

            // Hide canvas before capturing to avoid capturing it (only once for batch)
            const wasVisible = canvas && canvas.style.display !== 'none';
            if (canvas && !isBatchCapturing) {
                canvas.style.display = 'none';
            }

            // Scroll to the target position to capture
            window.scrollTo({top: scrollY, left: 0, behavior: 'instant'});

            // Wait for page to render at new position
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => requestAnimationFrame(resolve)); // Double RAF for stability

            // Request screenshot from background script
            const response = await browserAPI.runtime.sendMessage({
                command: "captureVisibleTab"
            });

            // Check for rate limit error
            if (response && response.error && response.error.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
                if (retryCount < maxRetries) {
                    // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
                    const backoffDelay = 100 * Math.pow(2, retryCount);
                    console.log(`[Scroll] Rate limit hit, retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);

                    // Release the lock before waiting
                    isCapturing = false;
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));

                    // Retry the capture
                    return await captureScreen(scrollY, skipRestore, retryCount + 1, maxRetries);
                } else {
                    throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
                }
            }

            let img = null;
            if (response && response.dataUrl) {
                // Load the screenshot as an image
                img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = response.dataUrl;
                });

                // Cache it
                capturedScreensCache.set(scrollY, img);

                // Don't limit cache size when pre-capturing everything
                // We want to keep all captured screens for smooth reading
            }

            // Only restore if not in batch mode or if explicitly requested
            if (!skipRestore) {
                // Show canvas again
                if (canvas && wasVisible && !isBatchCapturing) {
                    canvas.style.display = 'block';
                }

                // Restore scroll position
                console.log('[Scroll] Restoring scroll to:', currentScrollY);
                window.scrollTo({top: currentScrollY, left: 0, behavior: 'instant'});
            }

            return img;
        } catch (error) {
            console.error('Failed to capture screen:', error);
            return null;
        } finally {
            isCapturing = false;
        }
    }

    /**
     * Draw from cached screenshot or capture if needed
     */
    async function drawPageRegion(ctx, destX, destY, width, height, sourceScrollY) {
        // Round to nearest viewport to use cached screens
        const screenY = Math.floor(sourceScrollY / CANVAS_HEIGHT) * CANVAS_HEIGHT;

        const img = await captureScreen(screenY);
        if (!img) return;

        // Calculate the offset within the captured screen
        const offsetY = sourceScrollY - screenY;

        // The image from captureVisibleTab is at device pixel ratio
        const dpr = window.devicePixelRatio || 1;

        // Check if we need to read from multiple screens
        const availableHeight = CANVAS_HEIGHT - offsetY;

        if (height <= availableHeight) {
            // Single screen draw - all content fits in current cached screen
            ctx.drawImage(
                img,
                0, offsetY * dpr,           // Source X, Y (accounting for DPR)
                width * dpr, height * dpr,  // Source width, height (accounting for DPR)
                destX, destY,               // Destination X, Y
                width, height               // Destination width, height
            );
        } else {
            // Multi-screen draw - need to split across two cached screens
            // Draw first part from current screen
            ctx.drawImage(
                img,
                0, offsetY * dpr,
                width * dpr, availableHeight * dpr,
                destX, destY,
                width, availableHeight
            );

            // Draw remaining part from next screen
            const remainingHeight = height - availableHeight;
            await drawPageRegion(ctx, destX, destY + availableHeight, width, remainingHeight, screenY + CANVAS_HEIGHT);
        }
    }

    async function toggleReader(forceRecapture = false) {
        if (!canvas) {
            CANVAS_WIDTH = Math.floor(document.documentElement.clientWidth)
            CANVAS_HEIGHT = Math.floor(document.documentElement.clientHeight)
            NEXT_PAGE_DOC_SHIFT = CANVAS_HEIGHT * 0.03
            // Recalculate scroll interval now that we know the actual canvas height
            scrollInterval = calculateScrollInterval()
            canvas = document.createElement("canvas")
            canvas.id = "scroll"
            let dpr = window.devicePixelRatio || 1;
            canvas.width = CANVAS_WIDTH * dpr
            canvas.height = CANVAS_HEIGHT * dpr
            canvas.style.width = `${CANVAS_WIDTH}px`
            canvas.style.height = `${CANVAS_HEIGHT}px`

            // Style the canvas as a fixed overlay covering the viewport
            canvas.style.position = 'fixed'
            canvas.style.top = '0'
            canvas.style.left = '0'
            canvas.style.zIndex = '2147483647'
            canvas.style.cursor = 'pointer'
            canvas.style.backgroundColor = '#ffffff'

            drawingCtx = canvas.getContext('2d', {alpha: false})
            drawingCtx.scale(dpr, dpr)

            // Save user's current position for initial viewing
            initialUserScrollY = window.scrollY
            // Always capture entire document from top
            readStartYOffset = 0

            console.log('[Scroll] Initial state:', {
                readStartYOffset,
                initialUserScrollY,
                CANVAS_HEIGHT,
                windowScrollY: window.scrollY
            });

            // Check if we can reuse existing cache
            // Cache is valid only if dimensions haven't changed
            const dimensionsChanged = cachedDimensions.width !== CANVAS_WIDTH ||
                                     cachedDimensions.height !== CANVAS_HEIGHT;
            const canReuseCache = !forceRecapture &&
                                 capturedScreensCache.size > 0 &&
                                 !dimensionsChanged;

            if (dimensionsChanged && capturedScreensCache.size > 0) {
                console.log('[Scroll] Window dimensions changed - invalidating cache', {
                    old: cachedDimensions,
                    new: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
                });
                capturedScreensCache.clear();
            }

            if (canReuseCache) {
                console.log('[Scroll] Reusing existing cache with', capturedScreensCache.size, 'screens');

                // Send status update - no capturing needed
                browserAPI.runtime.sendMessage({
                    command: 'updateStatus',
                    isActive: true,
                    isCapturing: false,
                    captureProgress: ''
                });
            } else {
                // Clear cache if force recapturing
                if (forceRecapture) {
                    console.log('[Scroll] Force recapture - clearing cache');
                    capturedScreensCache.clear();
                }

                // Calculate how many screens to pre-capture
                // Capture the entire document
                const documentHeight = Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight
                );
                const maxScreensToCapture = Math.ceil((documentHeight - readStartYOffset) / CANVAS_HEIGHT);

                console.log('[Scroll] Pre-capturing all content...', {
                    documentHeight,
                    screensToCapture: maxScreensToCapture
                });

                // Send initial status update to background
                browserAPI.runtime.sendMessage({
                    command: 'updateStatus',
                    isActive: true,
                    isCapturing: true,
                    captureProgress: `0/${maxScreensToCapture}`
                });

                // Capture all screens upfront
                isBatchCapturing = true;
                for (let i = 0; i < maxScreensToCapture; i++) {
                    const targetY = readStartYOffset + CANVAS_HEIGHT * i;
                    await captureScreen(targetY, true); // Skip individual restores

                    // Update progress via background
                    browserAPI.runtime.sendMessage({
                        command: 'updateStatus',
                        isActive: true,
                        isCapturing: true,
                        captureProgress: `${i + 1}/${maxScreensToCapture}`
                    });

                    // Log progress every 5 screens
                    if ((i + 1) % 5 === 0) {
                        console.log(`[Scroll] Captured ${i + 1}/${maxScreensToCapture} screens`);
                    }
                }
                isBatchCapturing = false;

                // Update status: capturing complete
                browserAPI.runtime.sendMessage({
                    command: 'updateStatus',
                    isActive: true,
                    isCapturing: false,
                    captureProgress: ''
                });

                // Restore to user's initial position
                window.scrollTo({top: initialUserScrollY, left: 0, behavior: 'instant'});

                console.log('[Scroll] Pre-capture complete!', {
                    screensCached: capturedScreensCache.size
                });

                // Store dimensions used for this cache
                cachedDimensions.width = CANVAS_WIDTH;
                cachedDimensions.height = CANVAS_HEIGHT;
            }

            // Now draw initial viewport from cache starting at user's position
            await drawPageRegion(drawingCtx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, initialUserScrollY);

            documentOffset = initialUserScrollY + CANVAS_HEIGHT

            // Append canvas to page
            document.body.appendChild(canvas)

            // Ensure canvas is visible
            canvas.style.display = 'block'

            console.log('[Scroll] After canvas append:', {
                canvasPosition: canvas.style.position,
                canvasDisplay: canvas.style.display,
                canvasZIndex: canvas.style.zIndex,
                documentOffset,
                windowScrollY: window.scrollY,
                readStartYOffset,
                initialUserScrollY
            });

            registerEventListeners()
            startReading()
        } else {
            stopReading()
            deregisterEventListeners()
            canvas.remove()
            canvas = null
            documentOffset = 0
            canvasOffset = 0
            // Keep cache for reuse when reactivating
            // Update status: reader deactivated
            browserAPI.runtime.sendMessage({
                command: 'updateStatus',
                isActive: false,
                isCapturing: false,
                captureProgress: ''
            });
        }
    }
    async function checkAndReplenishCache() {
        // Check how many screens ahead we have cached
        const currentScreen = Math.floor(documentOffset / CANVAS_HEIGHT) * CANVAS_HEIGHT;
        let cachedAhead = 0;

        for (let i = 0; i < CACHE_AHEAD_SCREENS; i++) {
            if (capturedScreensCache.has(currentScreen + i * CANVAS_HEIGHT)) {
                cachedAhead++;
            } else {
                break;
            }
        }

        // If we're running low on cache, pause and batch-capture
        if (cachedAhead < CACHE_TRIGGER_SCREENS && !isBatchCapturing) {
            console.log('[Scroll] Cache running low, pausing to batch-capture');

            // Pause scrolling
            const wasScrolling = scrollDownInterval !== null;
            if (wasScrolling) {
                clearInterval(scrollDownInterval);
                scrollDownInterval = null;
            }

            isBatchCapturing = true;
            const savedScrollY = window.scrollY;

            // Hide canvas once for entire batch
            if (canvas) {
                canvas.style.display = 'none';
            }

            // Batch-capture next screens without restoring between each
            for (let i = 0; i < CACHE_AHEAD_SCREENS; i++) {
                const targetY = currentScreen + i * CANVAS_HEIGHT;
                if (!capturedScreensCache.has(targetY)) {
                    await captureScreen(targetY, true); // skipRestore=true
                }
            }

            // Restore scroll and show canvas once after all captures
            window.scrollTo({top: savedScrollY, left: 0, behavior: 'instant'});
            if (canvas) {
                canvas.style.display = 'block';
            }

            isBatchCapturing = false;
            console.log('[Scroll] Batch-capture complete, resuming');

            // Resume scrolling
            if (wasScrolling) {
                scrollDownInterval = setInterval(scrollDown, scrollInterval);
            }
        }
    }

    async function scrollDown(delta = DEFAULT_DELTA) {
        if (isCapturing || isBatchCapturing) {
            return; // Skip if capturing
        }

        let carryover = 0
        let spaceLeft = CANVAS_HEIGHT - canvasOffset
        if (delta > spaceLeft) {
            carryover = delta - spaceLeft
        }
        delta = delta - carryover
        drawingCtx.save()
        canvasOffset %= CANVAS_HEIGHT
        drawingCtx.translate(0, canvasOffset)

        // Calculate how many COMPLETE pages we've finished
        let pagesCompleted = Math.max(0, Math.floor((documentOffset - initialUserScrollY - CANVAS_HEIGHT) / CANVAS_HEIGHT) + 1);

        // Apply overlap ONLY if we've completed at least one page
        const sourceY = pagesCompleted > 0
            ? documentOffset - pagesCompleted * NEXT_PAGE_DOC_SHIFT
            : documentOffset;

        console.log('[Scroll] scrollDown:', {delta, documentOffset, pagesCompleted, sourceY});

        // Draw page content with extra buffer to overlap and cover old dividing lines
        const overlapBuffer = DIVIDING_LINE_HEIGHT;
        await drawPageRegion(drawingCtx, 0, -overlapBuffer, CANVAS_WIDTH, delta + overlapBuffer, sourceY - overlapBuffer);

        // Draw dividing line AFTER the content (at position delta)
        drawingCtx.fillStyle = '#000000';
        drawingCtx.fillRect(0, delta, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT);

        documentOffset += delta
        canvasOffset += delta
        drawingCtx.restore()

        // Synchronize browser scrollbar (page content is hidden behind fixed canvas)
        window.scrollTo({top: documentOffset - CANVAS_HEIGHT, left: 0, behavior: 'instant'})

        // No need to check cache since everything is pre-captured
        // checkAndReplenishCache(); // Disabled - all content captured upfront

        if (carryover > 0) {
            await scrollDown(carryover)
        }
    }
    async function scrollUp(delta) {
        if (isCapturing) {
            return; // Skip if already capturing
        }

        let carryover = 0
        let spaceLeft = canvasOffset
        if (spaceLeft > 0 && -delta > spaceLeft) {
            carryover = delta + spaceLeft
        }
        delta = delta - carryover
        canvasOffset = (CANVAS_HEIGHT + canvasOffset + delta) % CANVAS_HEIGHT
        documentOffset += delta
        drawingCtx.save()
        drawingCtx.translate(0, canvasOffset)

        // Draw dividing line first
        drawingCtx.fillStyle = '#000000';
        drawingCtx.fillRect(0, 0, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT);

        // Translate down by dividing line height
        drawingCtx.translate(0, DIVIDING_LINE_HEIGHT);

        // Calculate pages completed for overlap (same logic as scrollDown)
        let pagesCompleted = Math.max(0, Math.floor((documentOffset - initialUserScrollY - CANVAS_HEIGHT) / CANVAS_HEIGHT));

        // Draw previous content with extra buffer to overlap and cover old dividing lines
        const sourceY = pagesCompleted > 0
            ? documentOffset - CANVAS_HEIGHT - pagesCompleted * NEXT_PAGE_DOC_SHIFT
            : documentOffset - CANVAS_HEIGHT;

        console.log('[Scroll] scrollUp:', {delta, documentOffset, pagesCompleted, sourceY});

        const overlapBuffer = DIVIDING_LINE_HEIGHT;
        await drawPageRegion(drawingCtx, 0, -overlapBuffer, CANVAS_WIDTH, Math.abs(delta) + overlapBuffer, sourceY - overlapBuffer);

        drawingCtx.restore()

        // Synchronize browser scrollbar (page content is hidden behind fixed canvas)
        window.scrollTo({top: documentOffset - CANVAS_HEIGHT, left: 0, behavior: 'instant'})

        if (carryover < 0) {
            await scrollUp(carryover)
        }
    }
    function eventHandlerScrollPlayPause() {
        if (scrollDownInterval) {
            scrollDownInterval = clearInterval(scrollDownInterval)
        } else {
            scrollDownInterval = setInterval(
                scrollDown,
                scrollInterval
            )
        }
    }
    function eventHandlerManualScroll(event) {
        // Always prevent default to keep scrolling within canvas
        // This event listener is only active when canvas is visible
        event.preventDefault()
        event.stopPropagation()
        // console.log(event.deltaY)

        if (event.deltaY > 0) {
            scrollDown(event.deltaY) // Async but we don't need to wait
        } else {

            if ((Math.abs(event.deltaY) > 3)
                && scrollDownInterval) {
                scrollDownInterval = clearInterval(scrollDownInterval)
            }
            scrollUp(event.deltaY) // Async but we don't need to wait
        }
    }
    function eventHandlerToggleSpeed(event) {
        if (!scrollDownInterval) {
            // do nothing if not scrolling
            return
        }
        event.preventDefault()
        if (event.key === " ") {
            // Toggle between normal and 3x slower
            speedMultiplier = (speedMultiplier === 1) ? 3 : 1;
            scrollInterval = calculateScrollInterval();
        }
        clearInterval(scrollDownInterval)
        scrollDownInterval = setInterval(
            scrollDown,
            scrollInterval
        )
    }
    function eventHandlerTouchStart(event) {
        event.preventDefault();
        event.stopPropagation();

        const touch = event.touches[0];
        touchStartY = touch.clientY;
        touchStartX = touch.clientX;
        lastTouchY = touch.clientY;
        touchStartTime = Date.now();
        lastTouchTime = touchStartTime;
        touchVelocity = 0;
        hasMovedSignificantly = false;
        wasPausedByTouch = false;

        // Don't pause auto-scrolling immediately - wait to see if it's an upward scroll
    }
    function eventHandlerTouchMove(event) {
        event.preventDefault();
        event.stopPropagation();

        const touch = event.touches[0];
        const currentY = touch.clientY;
        const currentX = touch.clientX;
        const currentTime = Date.now();

        // Check if touch has moved significantly
        const totalDeltaY = Math.abs(currentY - touchStartY);
        const totalDeltaX = Math.abs(currentX - touchStartX);

        if (totalDeltaY > MOVEMENT_THRESHOLD || totalDeltaX > MOVEMENT_THRESHOLD) {
            hasMovedSignificantly = true;
        }

        // Only do manual scrolling if moved significantly
        if (hasMovedSignificantly) {
            // Fixed direction: drag down = scroll down, drag up = scroll up
            const deltaY = currentY - lastTouchY;

            if (Math.abs(deltaY) > 0) {
                if (deltaY > 0) {
                    // Dragging down = scrolling down
                    scrollDown(Math.abs(deltaY));
                } else {
                    // Dragging up = scrolling up
                    // Only pause auto-scroll if scrolling up significantly
                    if (Math.abs(deltaY) > SIGNIFICANT_UP_SCROLL && scrollDownInterval) {
                        clearInterval(scrollDownInterval);
                        scrollDownInterval = null;
                        wasPausedByTouch = true;
                    }
                    scrollUp(deltaY);
                }
            }

            // Calculate instantaneous velocity (pixels per millisecond)
            const timeDelta = currentTime - lastTouchTime;
            if (timeDelta > 0) {
                // Use exponential moving average for smoother velocity
                const instantVelocity = deltaY / timeDelta;
                touchVelocity = touchVelocity * 0.7 + instantVelocity * 0.3;
            }

            lastTouchY = currentY;
            lastTouchTime = currentTime;
        }
    }
    function eventHandlerTouchEnd(event) {
        event.preventDefault();
        event.stopPropagation();

        const touchDuration = Date.now() - touchStartTime;

        // Determine what kind of touch interaction this was
        if (!hasMovedSignificantly && touchDuration < TAP_THRESHOLD_MS) {
            // Quick tap - toggle pause/resume
            eventHandlerScrollPlayPause();
        } else if (hasMovedSignificantly && Math.abs(touchVelocity) > 0.2) {
            // Apply momentum scrolling based purely on final velocity
            // Momentum is the "coasting" continuation after finger lifts
            // The scrolling during the drag already happened in touchMove

            const absVelocity = Math.abs(touchVelocity);
            const velocitySign = touchVelocity >= 0 ? 1 : -1;

            // Non-linear scaling: fast flicks scroll exponentially further
            // velocity^1.8 means:
            // - 2x faster flick = 3.5x more momentum
            // - 3x faster flick = 7.2x more momentum
            // - 4x faster flick = 13.9x more momentum
            const momentumDistance = Math.pow(absVelocity, MOMENTUM_VELOCITY_POWER) * MOMENTUM_BASE_MULTIPLIER * velocitySign;

            console.log('[Touch] Momentum:', {
                touchVelocity: touchVelocity.toFixed(3),
                momentumDistance: momentumDistance.toFixed(1),
                pages: (Math.abs(momentumDistance) / CANVAS_HEIGHT).toFixed(2)
            });

            if (momentumDistance > 0) {
                // Momentum scrolling down
                scrollDown(Math.abs(momentumDistance));
            } else if (momentumDistance < 0) {
                // Momentum scrolling up
                scrollUp(momentumDistance);
            }
        }
        // If touch-and-hold with no movement and auto-scroll was active,
        // it's already running (we didn't pause it)

        // Reset tracking variables
        touchStartY = 0;
        touchStartX = 0;
        lastTouchY = 0;
        lastTouchTime = 0;
        touchVelocity = 0;
        hasMovedSignificantly = false;
        wasPausedByTouch = false;
    }
    function registerEventListeners() {
        canvas.addEventListener("click", eventHandlerScrollPlayPause)
        document.addEventListener("wheel", eventHandlerManualScroll, passiveSupported
            ? { passive: false } : false)
        document.addEventListener("keydown", eventHandlerToggleSpeed)
        // Touch events for mobile devices
        document.addEventListener("touchstart", eventHandlerTouchStart, passiveSupported
            ? { passive: false } : false)
        document.addEventListener("touchmove", eventHandlerTouchMove, passiveSupported
            ? { passive: false } : false)
        document.addEventListener("touchend", eventHandlerTouchEnd, passiveSupported
            ? { passive: false } : false)
    }
    function deregisterEventListeners() {
        canvas.removeEventListener("click", eventHandlerScrollPlayPause)
        document.removeEventListener("wheel", eventHandlerManualScroll)
        document.removeEventListener("keydown", eventHandlerToggleSpeed)
        // Touch events for mobile devices
        document.removeEventListener("touchstart", eventHandlerTouchStart)
        document.removeEventListener("touchmove", eventHandlerTouchMove)
        document.removeEventListener("touchend", eventHandlerTouchEnd)
    }
    function startReading() {
        scrollDownInterval = setInterval(
            scrollDown,
            scrollInterval
        )
        // No need to scroll - canvas is a fixed overlay
    }
    function stopReading() {
        if (scrollDownInterval) {
            scrollDownInterval = clearInterval(scrollDownInterval)
        }
        let initialScrollPageOffset = initialUserScrollY % CANVAS_HEIGHT
        let pagesOffset = Math.max(Math.floor((documentOffset - initialScrollPageOffset) / CANVAS_HEIGHT) - 1, 0)
        let pagesScrolled = Math.floor((documentOffset - initialUserScrollY) / CANVAS_HEIGHT) - 1

        let jumpToY = pagesOffset * CANVAS_HEIGHT + initialScrollPageOffset - pagesScrolled * NEXT_PAGE_DOC_SHIFT
        window.scroll({top: jumpToY, behavior: "auto"})
    }

    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.command === "toggleReader") {
            // Handle async toggleReader
            toggleReader().then(() => {
                // Return the actual state after toggling
                const isActive = canvas !== null;
                sendResponse({success: true, isActive: isActive});
            }).catch((error) => {
                console.error('Error toggling reader:', error);
                sendResponse({success: false, error: error.message});
            });
            return true; // Keep the message channel open for async response
        } else if (message.command === "recaptureReader") {
            // Handle async recapture - force a full recapture
            const wasActive = canvas !== null;

            (async () => {
                if (wasActive) {
                    // If active, deactivate first (preserves cache)
                    await toggleReader();
                }
                // Then activate with force recapture
                await toggleReader(true);
            })().then(() => {
                sendResponse({success: true, isActive: true});
            }).catch((error) => {
                console.error('Error recapturing:', error);
                sendResponse({success: false, error: error.message});
            });

            return true; // Keep the message channel open for async response
        } else if (message.command === "setScrollSpeed") {
            // Update scroll speed based on time-per-screen
            if (message.timePerScreen) {
                timePerScreen = message.timePerScreen;
                speedMultiplier = 1; // Reset to normal speed when user adjusts
                scrollInterval = calculateScrollInterval();

                // If scrolling is active, restart the interval with new speed
                if (scrollDownInterval !== null) {
                    clearInterval(scrollDownInterval);
                    scrollDownInterval = setInterval(scrollDown, scrollInterval);
                }
            }

            sendResponse({success: true});
            return true;
        }
    })

})();