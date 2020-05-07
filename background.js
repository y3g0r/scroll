async function injectContentScript() {
    await browser.tabs.executeScript({
        file: "content.js"
    })
    console.log(`Script injected`);
}
async function toggleReader() {
    let tabs = await browser.tabs.query({active: true, currentWindow: true})
    browser.tabs.sendMessage(tabs[0].id, {
        command: "toggleReader"
    })

}
browser.browserAction.onClicked.addListener(async () => {
    await injectContentScript()
    await toggleReader()
});

