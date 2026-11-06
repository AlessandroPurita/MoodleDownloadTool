const COURSE_HOST = "elearning.unimib.it";

const scanButton = document.querySelector("#scan");
const downloadButton = document.querySelector("#download");
const resultsSection = document.querySelector("#results");
const fileList = document.querySelector("#file-list");
const countLabel = document.querySelector("#count");
const selectAll = document.querySelector("#select-all");
const extensionFilter = document.querySelector("#extension-filter");
const searchQuery = document.querySelector("#search-query");
const noResults = document.querySelector("#no-results");
const zipOption = document.querySelector("#zip-option");
const statusLabel = document.querySelector("#status");
const progressArea = document.querySelector("#progress-area");
const progressTrack = document.querySelector("#progress-track");
const progressFill = document.querySelector("#progress-fill");
const progressMessage = document.querySelector("#progress-message");
const progressPercent = document.querySelector("#progress-percent");

let files = [];
let courseTitle = "corso-moodle";

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("error", isError);
}

function setProgress(percent, message, isError = false) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  progressArea.hidden = false;
  progressArea.classList.toggle("error", isError);
  progressFill.style.width = `${value}%`;
  progressTrack.setAttribute("aria-valuenow", String(value));
  progressPercent.textContent = `${value}%`;
  progressMessage.textContent = message;
}

function scanMoodleCourse() {
  const pageUrl = new URL(location.href);
  const isCoursePage = pageUrl.pathname.includes("/course/view.php") && pageUrl.searchParams.has("id");
  if (location.hostname !== "elearning.unimib.it" || !isCoursePage) {
    return { error: "Apri la pagina del corso Moodle prima di avviare la scansione." };
  }

  const publishProgress = (percent, message) => {
    window.__moodleDownloadToolProgress = { phase: "scan", percent, message };
  };
  publishProgress(0, "Leggo i collegamenti del corso…");

  const main = document.querySelector("#region-main") || document.querySelector("main") || document.body;
  const found = new Map();
  const folderPages = new Map();
  const folderErrors = [];

  function extensionFromFilename(value) {
    const basename = String(value || "").split(/[?#]/)[0].replace(/\\/g, "/").split("/").pop() || "";
    const match = basename.match(/\.([a-z0-9]{1,12})$/i);
    return match ? match[1].toLowerCase() : "";
  }

  function addFile(rawUrl, label, kind) {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return;
    }

    if (url.origin !== location.origin) return;
    const path = url.pathname.toLowerCase();
    let extension = "";
    if (path.includes("/pluginfile.php/")) {
      url.searchParams.set("forcedownload", "1");
      extension = extensionFromFilename(url.pathname);
      if (kind !== "File in cartella") kind = "File Moodle";
    } else if (path.endsWith("/mod/resource/view.php")) {
      url.searchParams.set("redirect", "1");
      kind = "Risorsa Moodle";
      extension = extensionFromFilename(label);
    } else {
      return;
    }

    const keyUrl = new URL(url.href);
    keyUrl.searchParams.delete("forcedownload");
    keyUrl.searchParams.delete("redirect");
    const key = keyUrl.href;
    if (!found.has(key)) {
      const cleanLabel = (label || "").replace(/\s+/g, " ").trim();
      found.set(key, {
        url: url.href,
        label: cleanLabel || decodeURIComponent(url.pathname.split("/").pop() || "File Moodle"),
        kind,
        extension
      });
    }
  }

  async function resolveResourceExtension(file) {
    if (file.kind !== "Risorsa Moodle" || file.extension) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(file.url, {
        method: "HEAD",
        credentials: "same-origin",
        redirect: "follow",
        signal: controller.signal
      });
      const finalUrl = new URL(response.url || file.url);
      if (finalUrl.origin === location.origin && finalUrl.pathname.toLowerCase().includes("/pluginfile.php/")) {
        file.extension = extensionFromFilename(finalUrl.pathname);
      }
      if (!file.extension) {
        const disposition = response.headers.get("content-disposition") || "";
        const encodedName = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        const plainName = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
        const headerName = encodedName?.[1] ? decodeURIComponent(encodedName[1].trim()) : plainName?.[1]?.trim();
        file.extension = extensionFromFilename(headerName);
      }
    } catch {
      // Il nome visibile resta comunque disponibile; il filtro mostrerà il tipo come non rilevato.
    } finally {
      clearTimeout(timeout);
    }
  }

  const courseAnchors = [...main.querySelectorAll("a[href]")];
  for (let anchorIndex = 0; anchorIndex < courseAnchors.length; anchorIndex += 1) {
    const anchor = courseAnchors[anchorIndex];
    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      continue;
    }
    if (url.origin !== location.origin) continue;

    const path = url.pathname.toLowerCase();
    if (path.includes("/pluginfile.php/")) {
      addFile(url.href, anchor.textContent || anchor.getAttribute("title"), "File Moodle");
    } else if (path.endsWith("/mod/resource/view.php") && url.searchParams.has("id")) {
      addFile(url.href, anchor.textContent || anchor.getAttribute("title"), "Risorsa Moodle");
    } else if (path.endsWith("/mod/folder/view.php") && url.searchParams.has("id")) {
      folderPages.set(url.href, anchor.textContent || anchor.getAttribute("title") || "Cartella Moodle");
    }
  }
  publishProgress(20, `Trovati ${found.size} collegamenti file; controllo le cartelle…`);

  return (async () => {
    const folders = [...folderPages.entries()];
    for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
      const [folderUrl, folderLabel] = folders[folderIndex];
      publishProgress(20 + Math.floor((folderIndex / Math.max(folders.length, 1)) * 30), `Leggo cartella ${folderIndex + 1} di ${folders.length}…`);
      try {
        const response = await fetch(folderUrl, { credentials: "same-origin", redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        let folderFileCount = 0;
        for (const anchor of doc.querySelectorAll("a[href]")) {
          const fileUrl = new URL(anchor.href, folderUrl);
          if (fileUrl.origin !== location.origin || !fileUrl.pathname.toLowerCase().includes("/pluginfile.php/")) continue;
          const label = anchor.textContent || anchor.getAttribute("title") || folderLabel;
          addFile(fileUrl.href, label, "File in cartella");
          folderFileCount += 1;
        }
        if (!folderFileCount) folderErrors.push(`${folderLabel}: nessun file standard trovato`);
      } catch (error) {
        folderErrors.push(`${folderLabel}: ${error.message || "impossibile leggere la cartella"}`);
      }
      publishProgress(20 + Math.floor(((folderIndex + 1) / Math.max(folders.length, 1)) * 30), `Cartelle lette ${folderIndex + 1} di ${folders.length}.`);
    }

    const items = [...found.values()];
    const resourcesToResolve = items.filter((file) => file.kind === "Risorsa Moodle" && !file.extension);
    publishProgress(50, `Rilevo il tipo dei file (${resourcesToResolve.length} da controllare)…`);
    for (let index = 0; index < resourcesToResolve.length; index += 4) {
      const batch = resourcesToResolve.slice(index, index + 4);
      await Promise.all(batch.map(resolveResourceExtension));
      const finished = Math.min(index + batch.length, resourcesToResolve.length);
      const percent = 50 + Math.floor((finished / Math.max(resourcesToResolve.length, 1)) * 45);
      publishProgress(percent, `Tipi di file rilevati ${finished} di ${resourcesToResolve.length}.`);
    }
    const title = document.querySelector("#page-header h1, [data-region='page-header'] h1, h1")?.textContent?.trim() || "corso-moodle";
    publishProgress(100, "Scansione completata.");
    return { title, files: items, folderCount: folderPages.size, folderErrors };
  })();
}

async function createCourseZip(selectedFiles, archiveName) {
  if (location.hostname !== "elearning.unimib.it" || !location.pathname.includes("/course/view.php")) {
    return { ok: false, error: "Apri la pagina del corso Moodle e riprova." };
  }
  if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) {
    return { ok: false, error: "Seleziona almeno un file." };
  }

  const panelId = "moodle-course-download-tool-progress";
  let panel = document.getElementById(panelId);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = panelId;
    panel.setAttribute("role", "status");
    panel.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:360px;padding:14px 16px;border:1px solid #d0d4d8;border-radius:10px;background:#fff;color:#202124;box-shadow:0 4px 18px #0003;font:14px/1.45 Segoe UI,Arial,sans-serif";
    document.body.append(panel);
  }
  const showProgress = (percent, message, error = false) => {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    window.__moodleDownloadToolProgress = { phase: "archive", percent: value, message, error };
    panel.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    if (error) text.style.color = "#a11932";
    panel.append(text);
  };
  showProgress(0, "Avvio preparazione dell’archivio…");

  function safeName(value) {
    return String(value || "materiale")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 180) || "materiale";
  }

  function decodeName(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  function extensionFromName(value) {
    const match = String(value || "").match(/\.([a-z0-9]{1,12})$/i);
    return match ? match[1].toLowerCase() : "";
  }

  function responseFilename(response, fallback) {
    const disposition = response.headers.get("content-disposition") || "";
    const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
    let name = encoded?.[1] ? decodeName(encoded[1].trim()) : plain?.[1]?.trim();
    if (!name) {
      const finalUrl = new URL(response.url);
      name = decodeName(finalUrl.pathname.split("/").pop() || "");
    }
    if (!name || name.toLowerCase() === "view.php") name = fallback.label || "materiale";
    name = safeName(name);
    if (!extensionFromName(name) && fallback.extension) name += `.${safeName(fallback.extension)}`;
    return name;
  }

  async function readResponseBytes(response, onProgress) {
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      onProgress(bytes.length);
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      onProgress(total);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  function uniqueName(name, used) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    const count = (used.get(name.toLowerCase()) || 0) + 1;
    used.set(name.toLowerCase(), count);
    return count === 1 ? name : `${base} (${count})${extension}`;
  }

  async function crc32(bytes, onProgress) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc ^= bytes[index];
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if ((index + 1) % 1048576 === 0) {
        onProgress(index + 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    onProgress(bytes.length);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function makeZip(entries, totalBytes) {
    if (entries.length > 65535) throw new Error("Lo ZIP classico supporta al massimo 65.535 file.");
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const year = Math.min(2107, Math.max(1980, now.getFullYear()));
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    let processedBytes = 0;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const nameBytes = encoder.encode(entry.name);
      const bytes = entry.bytes;
      if (nameBytes.length > 65535 || bytes.length > 0xffffffff || localOffset > 0xffffffff) {
        throw new Error("Un file supera i limiti del formato ZIP classico.");
      }
      const checksum = await crc32(bytes, (fileBytesProcessed) => {
        const fraction = totalBytes ? (processedBytes + fileBytesProcessed) / totalBytes : (entryIndex + 1) / entries.length;
        const percent = 68 + Math.floor(fraction * 30);
        showProgress(percent, `Aggiungo file allo ZIP: ${Math.min(entryIndex + 1, entries.length)} di ${entries.length}…`);
      });
      processedBytes += bytes.length;
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, bytes.length, true);
      localView.setUint32(22, bytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, bytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, bytes.length, true);
      centralView.setUint32(24, bytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      localOffset += localHeader.length + bytes.length;
      const fraction = totalBytes ? processedBytes / totalBytes : (entryIndex + 1) / entries.length;
      showProgress(68 + Math.floor(fraction * 30), `Aggiungo file allo ZIP: ${entryIndex + 1} di ${entries.length}…`);
    }

    const centralOffset = localOffset;
    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    if (centralOffset + centralSize + 22 > 0xffffffff) throw new Error("L’archivio supera il limite di 4 GB del formato ZIP classico.");

    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
  }

  const entries = [];
  const failed = [];
  let totalBytes = 0;
  const usedNames = new Map();
  try {
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
      const startPercent = 5 + Math.floor((index / selectedFiles.length) * 60);
      showProgress(startPercent, `Recupero file ${index + 1} di ${selectedFiles.length}: ${file.label || "materiale"}…`);
      try {
        const url = new URL(file.url, location.href);
        if (url.origin !== location.origin || url.hostname !== "elearning.unimib.it") throw new Error("Link fuori dal corso Moodle.");
        const response = await fetch(url.href, { credentials: "same-origin", redirect: "follow" });
        if (!response.ok) throw new Error(`Risposta Moodle ${response.status}`);
        const finalUrl = new URL(response.url || url.href);
        if (finalUrl.origin !== location.origin || /\/login(?:\/|$)/i.test(finalUrl.pathname)) {
          throw new Error("Accesso Moodle scaduto o file non accessibile.");
        }
        const contentType = response.headers.get("content-type") || "";
        if (finalUrl.pathname.toLowerCase().endsWith("/mod/resource/view.php") && contentType.includes("text/html")) {
          throw new Error("Moodle non ha restituito direttamente il file.");
        }
        const expectedLength = Number(response.headers.get("content-length")) || 0;
        const bytes = await readResponseBytes(response, (bytesRead) => {
          const fraction = expectedLength
            ? Math.min(bytesRead / expectedLength, 0.99)
            : Math.min(bytesRead / (bytesRead + 2 * 1024 * 1024), 0.9);
          const percent = 5 + ((index + fraction) / selectedFiles.length) * 60;
          const megabytes = (bytesRead / (1024 * 1024)).toFixed(1);
          showProgress(percent, `Scarico file ${index + 1} di ${selectedFiles.length} (${megabytes} MB)…`);
        });
        if (bytes.length > 0xffffffff || totalBytes + bytes.length > 0xffffffff) {
          throw new Error("L’archivio supererebbe il limite di 4 GB del formato ZIP classico.");
        }
        totalBytes += bytes.length;
        const name = uniqueName(responseFilename(response, file), usedNames);
        entries.push({ name, bytes });
      } catch (error) {
        failed.push({ label: String(file.label || "File"), reason: error.message || "errore" });
      }
      const finishedPercent = 5 + Math.floor(((index + 1) / selectedFiles.length) * 60);
      showProgress(finishedPercent, `File recuperati ${index + 1} di ${selectedFiles.length}.`);
    }

    if (!entries.length) throw new Error("Non è stato possibile recuperare nessuno dei file selezionati.");
    showProgress(68, `Creo l’archivio ZIP con ${entries.length} file…`);
    const blob = await makeZip(entries, totalBytes);
    const objectUrl = URL.createObjectURL(blob);
    const oldUrl = panel.dataset.objectUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    panel.dataset.objectUrl = objectUrl;

    panel.replaceChildren();
    const message = document.createElement("div");
    message.textContent = `Archivio pronto: ${entries.length} file${failed.length ? ` (${failed.length} non inclusi)` : ""}.`;
    message.style.marginBottom = "8px";
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = archiveName;
    link.textContent = "Scarica archivio ZIP";
    link.style.cssText = "display:inline-block;margin-right:12px;color:#a6193c;font-weight:700";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Chiudi";
    close.style.cssText = "border:0;background:transparent;color:#5f6368;cursor:pointer;font:inherit";
    close.addEventListener("click", () => {
      URL.revokeObjectURL(objectUrl);
      panel.remove();
    }, { once: true });
    panel.append(message, link, close);
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      panel.remove();
    }, 30 * 60 * 1000);
    link.click();
    window.__moodleDownloadToolProgress = {
      phase: "archive",
      percent: 100,
      message: `Archivio pronto: ${entries.length} file.`
    };

    return {
      ok: true,
      archiveName,
      included: entries.length,
      totalBytes,
      failed
    };
  } catch (error) {
    showProgress(100, error.message || "Creazione dello ZIP non riuscita.", true);
    throw error;
  }
}

async function getCourseTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("Non riesco a leggere la scheda attiva.");
  const page = new URL(tab.url);
  if (page.hostname !== COURSE_HOST || !page.pathname.includes("/course/view.php")) {
    throw new Error("Apri il corso su elearning.unimib.it e riprova.");
  }
  return tab;
}

function readCourseProgress(phase) {
  const progress = window.__moodleDownloadToolProgress;
  return progress?.phase === phase ? progress : null;
}

async function executeWithProgress(tabId, phase, func, args = []) {
  let settled = false;
  const task = chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args
  });
  task.then(() => { settled = true; }, () => { settled = true; });

  while (!settled) {
    try {
      const [snapshot] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: readCourseProgress,
        args: [phase]
      });
      if (snapshot?.result) {
        setProgress(snapshot.result.percent, snapshot.result.message, snapshot.result.error);
      }
    } catch {
      // L'iniezione principale restituisce comunque l'errore al termine.
    }
    if (!settled) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const [result] = await task;
  return result?.result;
}

function normalizeDownloadUrl(file) {
  const url = new URL(file.url);
  if (url.protocol !== "https:" || url.hostname !== COURSE_HOST) {
    throw new Error("Il collegamento non appartiene al sito Moodle del corso.");
  }
  const path = url.pathname.toLowerCase();
  if (path.includes("/pluginfile.php/")) {
    url.searchParams.set("forcedownload", "1");
  } else if (path.endsWith("/mod/resource/view.php") && url.searchParams.has("id")) {
    url.searchParams.set("redirect", "1");
  } else {
    throw new Error("Tipo di collegamento Moodle non supportato.");
  }
  return url.href;
}

async function downloadSelectedSeparately(selected) {
  const activeDownloads = [];
  const failures = [];
  for (let index = 0; index < selected.length; index += 1) {
    const file = selected[index];
    setProgress(5 + Math.floor((index / selected.length) * 20), `Avvio download ${index + 1} di ${selected.length}: ${file.label}…`);
    try {
      const id = await chrome.downloads.download({
        url: normalizeDownloadUrl(file),
        conflictAction: "uniquify",
        saveAs: false
      });
      activeDownloads.push({ id, label: file.label });
    } catch (error) {
      failures.push({ label: file.label, reason: error.message || "download non avviato" });
    }
    setProgress(5 + Math.floor(((index + 1) / selected.length) * 20), `Download avviati ${index + 1} di ${selected.length}.`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  if (!activeDownloads.length) {
    setProgress(100, "Nessun download avviato.", true);
    return { completed: 0, failures };
  }

  let finalStates = [];
  let pollErrors = 0;
  while (true) {
    try {
      finalStates = await Promise.all(activeDownloads.map(async (download) => {
        const [item] = await chrome.downloads.search({ id: download.id });
        return { label: download.label, state: item?.state || "interrupted" };
      }));
      pollErrors = 0;
    } catch {
      pollErrors += 1;
      if (pollErrors >= 5) break;
    }

    const finished = finalStates.filter((item) => item.state === "complete" || item.state === "interrupted").length;
    const completed = finalStates.filter((item) => item.state === "complete").length;
    const settledCount = Math.min(selected.length, finished + failures.length);
    const percent = 25 + Math.floor((settledCount / selected.length) * 75);
    setProgress(percent, `Download completati ${completed} di ${selected.length}${failures.length ? ` · errori ${failures.length}` : ""}.`);
    if (finished === activeDownloads.length || pollErrors >= 5) break;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const interrupted = finalStates.filter((item) => item.state === "interrupted");
  const allFailures = [...failures, ...interrupted.map((item) => ({ label: item.label, reason: "download interrotto" }))];
  const completed = finalStates.filter((item) => item.state === "complete").length;
  const trackingUnavailable = pollErrors >= 5;
  setProgress(100, trackingUnavailable ? `Download avviati: ${activeDownloads.length}. Stato finale non disponibile.` : `Download completati: ${completed} di ${selected.length}.`, allFailures.length > 0);
  return { completed, failures: allFailures, started: activeDownloads.length, trackingUnavailable };
}

function updateCount() {
  const checkboxes = [...fileList.querySelectorAll("input[type=checkbox]")];
  const visible = checkboxes.filter((checkbox) => !checkbox.closest(".file-row").hidden);
  const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
  const selectedVisible = visible.filter((checkbox) => checkbox.checked).length;
  countLabel.textContent = `${selected} selezionati · ${selectedVisible} nel filtro`;
  downloadButton.disabled = selected === 0;
  const action = zipOption.checked ? "Crea ZIP" : "Scarica file";
  downloadButton.textContent = selected ? `${action} (${selected})` : (zipOption.checked ? "Crea archivio ZIP" : "Scarica file selezionati");
  selectAll.checked = visible.length > 0 && selectedVisible === visible.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
}

function populateExtensionFilter() {
  const counts = new Map();
  for (const file of files) {
    const extension = file.extension || "unknown";
    counts.set(extension, (counts.get(extension) || 0) + 1);
  }

  extensionFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `Tutte le estensioni (${files.length})`;
  extensionFilter.append(allOption);

  for (const [extension, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = extension;
    option.textContent = extension === "unknown"
      ? `Tipo non rilevato (${count})`
      : `.${extension.toUpperCase()} (${count})`;
    extensionFilter.append(option);
  }
  extensionFilter.value = "all";
  extensionFilter.disabled = files.length === 0;
}

function applyFilters() {
  const selectedExtension = extensionFilter.value;
  const query = searchQuery.value.trim().toLocaleLowerCase();
  let visibleCount = 0;
  fileList.querySelectorAll(".file-row").forEach((row) => {
    const extensionMatches = selectedExtension === "all" || row.dataset.extension === selectedExtension;
    const queryMatches = !query || row.dataset.search.includes(query);
    row.hidden = !extensionMatches || !queryMatches;
    if (!row.hidden) visibleCount += 1;
  });
  noResults.hidden = files.length === 0 || visibleCount !== 0;
  updateCount();
}

function renderFiles() {
  fileList.replaceChildren();
  populateExtensionFilter();
  files.forEach((file, index) => {
    const row = document.createElement("label");
    row.className = "file-row";
    row.dataset.extension = file.extension || "unknown";
    row.dataset.search = `${file.label} ${file.kind} ${file.extension || ""} ${file.url}`.toLocaleLowerCase();
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = false;
    checkbox.dataset.index = String(index);
    checkbox.addEventListener("change", updateCount);

    const text = document.createElement("span");
    text.className = "file-name";
    text.append(document.createTextNode(file.label));
    const kind = document.createElement("span");
    kind.className = "file-kind";
    kind.textContent = `${file.extension ? `.${file.extension.toUpperCase()} · ` : "Tipo non rilevato · "}${file.kind}`;
    text.append(kind);
    row.append(checkbox, text);
    fileList.append(row);
  });
  resultsSection.hidden = false;
  applyFilters();
  updateCount();
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  resultsSection.hidden = true;
  files = [];
  searchQuery.value = "";
  setStatus("Sto cercando i file nella pagina e nelle cartelle Moodle…");
  setProgress(0, "Avvio scansione…");
  try {
    const tab = await getCourseTab();
    const result = await executeWithProgress(tab.id, "scan", scanMoodleCourse);
    if (!result) throw new Error("La scansione non ha restituito risultati.");
    if (result.error) throw new Error(result.error);

    files = result.files || [];
    courseTitle = result.title || "corso-moodle";
    renderFiles();
    const folderNote = result.folderErrors?.length
      ? ` Alcune cartelle non sono state lette (${result.folderErrors.length}).`
      : "";
    setProgress(100, `Scansione completata: ${files.length} file trovati.`);
    if (files.length) {
      const detectedTypes = new Set(files.map((file) => file.extension).filter(Boolean)).size;
      setStatus(`Trovati ${files.length} file con ${detectedTypes} tipi di estensione rilevati.${folderNote} Filtra e seleziona cosa scaricare.`);
    } else {
      setStatus(`Non ho trovato file Moodle standard in questa pagina.${folderNote} Prova a espandere le sezioni del corso e a scansionare di nuovo.`, true);
    }
  } catch (error) {
    setStatus(error.message || "Scansione non riuscita.", true);
    setProgress(100, "Scansione non riuscita.", true);
  } finally {
    scanButton.disabled = false;
  }
});

selectAll.addEventListener("change", () => {
  fileList.querySelectorAll(".file-row:not([hidden]) input[type=checkbox]").forEach((checkbox) => {
    checkbox.checked = selectAll.checked;
  });
  updateCount();
});

extensionFilter.addEventListener("change", applyFilters);
searchQuery.addEventListener("input", applyFilters);
zipOption.addEventListener("change", updateCount);

downloadButton.addEventListener("click", async () => {
  const selected = [...fileList.querySelectorAll("input[type=checkbox]:checked")]
    .map((checkbox) => files[Number(checkbox.dataset.index)])
    .filter(Boolean);
  if (!selected.length) return;

  downloadButton.disabled = true;
  scanButton.disabled = true;
  zipOption.disabled = true;
  selectAll.disabled = true;
  extensionFilter.disabled = true;
  searchQuery.disabled = true;
  fileList.querySelectorAll("input[type=checkbox]").forEach((checkbox) => { checkbox.disabled = true; });
  try {
    const tab = await getCourseTab();
    if (zipOption.checked) {
      setStatus(`Recupero ${selected.length} file e preparo lo ZIP… lascia aperta questa finestra.`);
      setProgress(0, "Avvio creazione ZIP…");
      const safeTitle = courseTitle
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "corso-moodle";
      const result = await executeWithProgress(tab.id, "archive", createCourseZip, [selected, `Materiali_${safeTitle}.zip`]);
      if (!result?.ok) throw new Error(result?.error || "Non è stato possibile creare l’archivio.");
      const omitted = result.failed?.length || 0;
      setProgress(100, `ZIP pronto: ${result.included} file.`);
      setStatus(`Archivio ZIP pronto con ${result.included} file${omitted ? `; ${omitted} non inclusi` : ""}. Se il download non parte, usa il link comparso nella pagina del corso.`);
    } else {
      setStatus(`Avvio e controllo ${selected.length} download singoli…`);
      setProgress(0, "Avvio dei download…");
      const result = await downloadSelectedSeparately(selected);
      const errors = result.failures?.length || 0;
      setStatus(`Download completati: ${result.completed} di ${selected.length}${errors ? `; errori ${errors}` : ""}.${result.trackingUnavailable ? " I file possono comunque continuare a scaricarsi in Edge." : ""}`);
    }
  } catch (error) {
    setStatus(error.message || (zipOption.checked ? "Non è stato possibile creare lo ZIP." : "Non è stato possibile avviare i download."), true);
    setProgress(100, "Operazione non riuscita.", true);
  } finally {
    downloadButton.disabled = false;
    scanButton.disabled = false;
    zipOption.disabled = false;
    selectAll.disabled = false;
    extensionFilter.disabled = files.length === 0;
    searchQuery.disabled = false;
    fileList.querySelectorAll("input[type=checkbox]").forEach((checkbox) => { checkbox.disabled = false; });
    updateCount();
  }
});
