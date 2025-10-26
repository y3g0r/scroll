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
    let scrollInterval = NORMAL_SCROLL_INTERVAL
    let isCapturing = false // Prevent concurrent captures
    let isBatchCapturing = false // Batch capture in progress

    // Performance optimization: cache captured screens
    let capturedScreensCache = new Map() // Map of scrollY -> Image
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

    async function toggleReader() {
        if (!canvas) {
            CANVAS_WIDTH = Math.floor(document.documentElement.clientWidth)
            CANVAS_HEIGHT = Math.floor(document.documentElement.clientHeight)
            NEXT_PAGE_DOC_SHIFT = CANVAS_HEIGHT * 0.03
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
            readStartYOffset = window.scrollY

            console.log('[Scroll] Initial state:', {
                readStartYOffset,
                CANVAS_HEIGHT,
                windowScrollY: window.scrollY
            });

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

            // Restore to starting position
            window.scrollTo({top: readStartYOffset, left: 0, behavior: 'instant'});

            console.log('[Scroll] Pre-capture complete!', {
                screensCached: capturedScreensCache.size
            });

            // Now draw initial viewport from cache
            await drawPageRegion(drawingCtx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, readStartYOffset);

            documentOffset = readStartYOffset + CANVAS_HEIGHT

            // Append canvas to page
            document.body.appendChild(canvas)

            console.log('[Scroll] After canvas append:', {
                canvasPosition: canvas.style.position,
                canvasDisplay: canvas.style.display,
                canvasZIndex: canvas.style.zIndex,
                documentOffset,
                windowScrollY: window.scrollY,
                readStartYOffset
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
            // Clear cache
            capturedScreensCache.clear()
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
        let pagesCompleted = Math.max(0, Math.floor((documentOffset - readStartYOffset - CANVAS_HEIGHT) / CANVAS_HEIGHT) + 1);

        // Apply overlap ONLY if we've completed at least one page
        const sourceY = pagesCompleted > 0
            ? documentOffset - pagesCompleted * NEXT_PAGE_DOC_SHIFT
            : documentOffset;

        console.log('[Scroll] scrollDown:', {delta, documentOffset, pagesCompleted, sourceY});

        // Draw page content first (at position 0, for 'delta' pixels)
        await drawPageRegion(drawingCtx, 0, 0, CANVAS_WIDTH, delta, sourceY);

        // Draw dividing line AFTER the content (at position delta)
        drawingCtx.fillRect(0, delta, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)

        documentOffset += delta
        canvasOffset += delta
        drawingCtx.restore()

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
        drawingCtx.fillRect(0, 0, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)

        // Translate down by 1 pixel, just like original
        drawingCtx.translate(0, DIVIDING_LINE_HEIGHT)

        // Calculate pages completed for overlap (same logic as scrollDown)
        let pagesCompleted = Math.max(0, Math.floor((documentOffset - readStartYOffset - CANVAS_HEIGHT) / CANVAS_HEIGHT));

        // Draw previous content - draw abs(delta) pixels, not abs(delta)-1
        // This ensures we fully cover any old dividing lines from previous scrollDown operations
        const sourceY = pagesCompleted > 0
            ? documentOffset - CANVAS_HEIGHT - pagesCompleted * NEXT_PAGE_DOC_SHIFT
            : documentOffset - CANVAS_HEIGHT;

        console.log('[Scroll] scrollUp:', {delta, documentOffset, pagesCompleted, sourceY});

        await drawPageRegion(drawingCtx, 0, 0, CANVAS_WIDTH, Math.abs(delta), sourceY);

        drawingCtx.restore()
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
        if (event.target === canvas) {
            event.preventDefault()
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
    }
    function eventHandlerToggleSpeed(event) {
        if (!scrollDownInterval) {
            // do nothing if not scrolling
            return
        }
        event.preventDefault()
        if (event.key === " ") {
            if (scrollInterval === NORMAL_SCROLL_INTERVAL) {
                scrollInterval = NORMAL_SCROLL_INTERVAL * 3
            }
            else {
                scrollInterval = NORMAL_SCROLL_INTERVAL
            }
        }
        clearInterval(scrollDownInterval)
        scrollDownInterval = setInterval(
            scrollDown,
            scrollInterval
        )
    }
    function registerEventListeners() {
        canvas.addEventListener("click", eventHandlerScrollPlayPause)
        document.addEventListener("wheel", eventHandlerManualScroll, passiveSupported
            ? { passive: false } : false)
        document.addEventListener("keydown", eventHandlerToggleSpeed)
    }
    function deregisterEventListeners() {
        canvas.removeEventListener("click", eventHandlerScrollPlayPause)
        document.removeEventListener("wheel", eventHandlerManualScroll)
        document.removeEventListener("keydown", eventHandlerToggleSpeed)
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
        let initialScrollPageOffset = readStartYOffset % CANVAS_HEIGHT
        let pagesOffset = Math.max(Math.floor((documentOffset - initialScrollPageOffset) / CANVAS_HEIGHT) - 1, 0)
        let pagesScrolled = Math.floor((documentOffset - readStartYOffset) / CANVAS_HEIGHT) - 1

        let jumpToY = pagesOffset * CANVAS_HEIGHT + initialScrollPageOffset - pagesScrolled * NEXT_PAGE_DOC_SHIFT
        window.scroll({top: jumpToY, behavior: "auto"})
    }

    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.command === "toggleReader") {
            // Handle async toggleReader
            toggleReader().then(() => {
                sendResponse({success: true});
            }).catch((error) => {
                console.error('Error toggling reader:', error);
                sendResponse({success: false, error: error.message});
            });
            return true; // Keep the message channel open for async response
        }
    })

})();