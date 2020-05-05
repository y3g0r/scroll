function onCreated(tab) {
    console.log(`Created new tab: ${tab.id}`)
}

function onError(error) {
    console.log(`Error: ${error}`);
}

browser.browserAction.onClicked.addListener(async () => {
    // var creating = browser.tabs.create({
    //     url:"https://example.org"
    // });
    // creating.then(onCreated, onError);
    let tabs = null
    try {
        tabs = await browser.tabs.query({active: true, currentWindow: true})
    }
    catch {
        console.log("missing permisssion tabs?")
    }
    if (!tabs) {
        return
    }
    browser.tabs.sendMessage(tabs[0].id, {
        command: "toggleReader"
    })
});

