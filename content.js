const DIVIDING_LINE_HEIGHT = 1
const DEFAULT_DELTA = 1
function main() {
    console.log("Initializing extension")
    let canvas = document.createElement("canvas")
    canvas.id = "mozreader"
    let viewportHeight = window.innerHeight - 20
    let CANVAS_WIDTH = window.innerWidth - 30
    canvas.width = CANVAS_WIDTH
    canvas.height = viewportHeight
    canvas.setAttribute("style", "border: 1px solid blue;")
    document.body.appendChild(canvas)
    let ctx = canvas.getContext('2d', {alpha: false})
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawWindow(window, 0, 0, CANVAS_WIDTH, viewportHeight, 'rgb(255,255,255)');
    // document will be drawn starting from this y position
    let documentOffset = viewportHeight
    // where in the viewport new content will be drawn
    let viewportOffset = 0
    function scroll(delta = DEFAULT_DELTA) {
        ctx.save()
        // start drawing next viewport including last pixels of current
        // if (viewportOffset % viewportHeight === 0) {
        //         documentOffset -= 30
        // }
        viewportOffset %= viewportHeight
        ctx.translate(0, viewportOffset)
        ctx.fillRect(0, delta, CANVAS_WIDTH, DIVIDING_LINE_HEIGHT)
        ctx.drawWindow(window, 0, documentOffset, CANVAS_WIDTH, delta, 'rgb(255,255,255)');
        documentOffset += delta
        viewportOffset += delta
        ctx.restore()
    }
    let intervalId = setInterval(
        scroll,
        100
    )
    canvas.addEventListener("click", event => {
        if (intervalId) {
            intervalId = clearInterval(intervalId)
        }
        else {
            intervalId = setInterval(
                scroll,
                100
            )
        }
    })
    document.addEventListener("wheel", event => {
        if (event.target === canvas){
            console.log(event.deltaY)

            // scroll(Math.min(event.deltaY, 30))
            if (event.deltaY > 0) {
                scroll(event.deltaY)
            }
        }
    })
    console.log("Initializing extension done")
}
console.log("About to set timeout on main...")
setTimeout(main, 2000)

// document.addEventListener('readystatechange', event => {
//     if (event.target.readyState === "complete") {
//         main()
//     }
// })