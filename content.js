(function() {
    if (window.mozReaderRunning) {
        return
    }
    window.mozReaderRunning = true

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

    function toggleReader() {
        if (!canvas) {
            CANVAS_WIDTH = document.documentElement.clientWidth
            CANVAS_HEIGHT = document.documentElement.clientHeight
            NEXT_PAGE_DOC_SHIFT = CANVAS_HEIGHT * 0.03
            canvas = document.createElement("canvas")
            canvas.id = "mozreader"
            let dpr = window.devicePixelRatio || 1;
            canvas.width = CANVAS_WIDTH * dpr
            canvas.height = CANVAS_HEIGHT * dpr
            canvas.style.width = `${Math.floor(canvas.width / dpr)}px`
            canvas.style.height = `${Math.floor(canvas.height / dpr)}px`
            drawingCtx = canvas.getContext('2d', {alpha: false})
            drawingCtx.scale(dpr, dpr)
            readStartYOffset = window.scrollY
            drawingCtx.drawWindow(window, 0, readStartYOffset, CANVAS_WIDTH, CANVAS_HEIGHT, 'rgb(255,255,255)');
            documentOffset = readStartYOffset + CANVAS_HEIGHT
            document.body.appendChild(canvas)
            registerEventListeners()
            startReading()
        } else {
            stopReading()
            deregisterEventListeners()
            canvas.remove()
            canvas = null
            documentOffset = 0
            canvasOffset = 0
        }
    }
    function scrollDown(delta = DEFAULT_DELTA) {
        let pagesRead = Math.floor((documentOffset - readStartYOffset) / CANVAS_HEIGHT)
        let carryover = 0
        let spaceLeft = CANVAS_HEIGHT - canvasOffset
        if (delta > spaceLeft) {
            carryover = delta - spaceLeft
        }
        delta = delta - carryover
        drawingCtx.save()
        canvasOffset %= CANVAS_HEIGHT
        drawingCtx.translate(0, canvasOffset)
        drawingCtx.fillRect(0, delta, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)
        drawingCtx.drawWindow(window, 0, documentOffset - pagesRead * NEXT_PAGE_DOC_SHIFT, CANVAS_WIDTH, delta, 'rgb(255,255,255)');
        documentOffset += delta
        canvasOffset += delta
        drawingCtx.restore()
        if (carryover > 0) {
            scrollDown(carryover)
        }
    }
    function scrollUp(delta) {
        let pagesRead = Math.floor((documentOffset - readStartYOffset) / CANVAS_HEIGHT) - 1

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
        drawingCtx.fillRect(0, 0, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)
        drawingCtx.translate(0, 1)
        drawingCtx.drawWindow(window, 0, documentOffset - CANVAS_HEIGHT - pagesRead * NEXT_PAGE_DOC_SHIFT,
                              CANVAS_WIDTH, Math.abs(delta), 'rgb(255,255,255)');
        drawingCtx.restore()
        if (carryover < 0) {
            scrollUp(carryover)
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
                scrollDown(event.deltaY)
            } else {

                if ((Math.abs(event.deltaY) > 3)
                    && scrollDownInterval) {
                    scrollDownInterval = clearInterval(scrollDownInterval)
                }
                scrollUp(event.deltaY)
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
        window.scroll({top: canvas.offsetTop, behavior: "auto"})
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

    browser.runtime.onMessage.addListener((message) => {
        if (message.command === "toggleReader") {
            toggleReader()
        }
    })

})();