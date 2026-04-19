import { countTokens } from "./tokenizer.js";
import { getData, addTokens, saveData } from "./storage.js";

async function updateUI() {
    const data = await getData();
    document.getElementById("session").innerText = data.sessionTokens;
    document.getElementById("total").innerText = data.totalTokens;
}

document.getElementById("count").onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, { type: "GET_TEXT" }, async (response) => {
        const tokens = countTokens(response.text);
        await addTokens(tokens);
        updateUI();
    });
};

document.getElementById("export").onclick = async () => {
    const data = await getData();

    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "token_snapshot.json";
    a.click();
};

document.getElementById("import").onchange = async (e) => {
    const file = e.target.files[0];
    const text = await file.text();
    const data = JSON.parse(text);

    await saveData(data);
    updateUI();
};

updateUI();