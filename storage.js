const DEFAULT_DATA = {
    sessionTokens: 0,
    totalTokens: 0
};

export async function getData() {
    return new Promise(resolve => {
        chrome.storage.local.get(["tokenData"], (res) => {
            resolve(res.tokenData || DEFAULT_DATA);
        });
    });
}

export async function saveData(data) {
    return new Promise(resolve => {
        chrome.storage.local.set({ tokenData: data }, resolve);
    });
}

export async function addTokens(count) {
    const data = await getData();
    data.sessionTokens += count;
    data.totalTokens += count;
    await saveData(data);
}