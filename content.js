(function() {
    const DIVIDING_LINE_HEIGHT = 1
    const DEFAULT_DELTA = 1
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

    function toggleReader() {
        if (!canvas) {
            CANVAS_WIDTH = document.documentElement.clientWidth
            CANVAS_HEIGHT = document.documentElement.clientHeight
            canvas = document.createElement("canvas")
            canvas.id = "mozreader"
            canvas.width = CANVAS_WIDTH
            canvas.height = CANVAS_HEIGHT
            // canvas.setAttribute("style", "border: 1px solid blue;")
            drawingCtx = canvas.getContext('2d', {alpha: false})
            // drawingCtx.imageSmoothingEnabled = true
            // drawingCtx.imageSmoothingQuality = "high"
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
        // todo: handle carry over (when delta > CANVAS_HEIGHT - canvasOffset)
        drawingCtx.save()
        // start drawing next viewport including last pixels of current
        // if (canvasOffset % CANVAS_HEIGHT === 0) {
        //         documentOffset -= 30
        // }
        canvasOffset %= CANVAS_HEIGHT
        drawingCtx.translate(0, canvasOffset)
        drawingCtx.fillRect(0, delta, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)
        drawingCtx.drawWindow(window, 0, documentOffset, CANVAS_WIDTH, delta, 'rgb(255,255,255)');
        documentOffset += delta
        canvasOffset += delta
        drawingCtx.restore()
    }
    function scrollUp(delta) {
        // todo: handle carry over when (delta > canvasOffset)
        canvasOffset = (CANVAS_HEIGHT + canvasOffset + delta) % CANVAS_HEIGHT
        documentOffset += delta
        // console.log("canvasOffset: ", canvasOffset, ", documentOffset: ", documentOffset)
        drawingCtx.save()
        drawingCtx.translate(0, canvasOffset)
        drawingCtx.fillRect(0, 0, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)
        drawingCtx.translate(0, 1)
        drawingCtx.drawWindow(window, 0, documentOffset - CANVAS_HEIGHT, CANVAS_WIDTH, Math.abs(delta), 'rgb(255,255,255)');
        drawingCtx.restore()
    }
    function eventHandlerScrollPlayPause() {
        if (scrollDownInterval) {
            scrollDownInterval = clearInterval(scrollDownInterval)
        } else {
            scrollDownInterval = setInterval(
                scrollDown,
                100
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
    function registerEventListeners() {
        canvas.addEventListener("click", eventHandlerScrollPlayPause)
        document.addEventListener("wheel", eventHandlerManualScroll)
    }
    function deregisterEventListeners() {
        canvas.removeEventListener("click", eventHandlerScrollPlayPause)
        document.removeEventListener("wheel", eventHandlerManualScroll)
    }
    function startReading() {
        scrollDownInterval = setInterval(
            scrollDown,
            100
        )
        window.scroll({top: 999999, left: 0, behavior: "auto"})
    }
    function stopReading() {
        if (scrollDownInterval) {
            scrollDownInterval = clearInterval(scrollDownInterval)
        }
        let initialScrollPageOffset = readStartYOffset % CANVAS_HEIGHT
        let pagesOffset = Math.max(Math.floor((documentOffset - initialScrollPageOffset) / CANVAS_HEIGHT) - 1, 0)
        let jumpToY = pagesOffset * CANVAS_HEIGHT + initialScrollPageOffset
        window.scroll({top: jumpToY, left: 0, behavior: "auto"})
    }

    browser.runtime.onMessage.addListener((message) => {
        if (message.command === "toggleReader") {
            toggleReader()
        }
    })

})();