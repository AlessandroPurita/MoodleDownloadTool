const COURSE_HOST = "elearning.unimib.it";

const scanButton = document.querySelector("#scan");
const downloadButton = document.querySelector("#download");
const resultsSection = document.querySelector("#results");
const fileList = document.querySelector("#file-list");
const countLabel = document.querySelector("#count");
const selectAll = document.querySelector("#select-all");
const extensionFilter = document.querySelector("#extension-filter");
const statusLabel = document.querySelector("#status");

let files = [];
let courseTitle = "corso-moodle";

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("error", isError);
}

function scanMoodleCourse() {
  const pageUrl = new URL(location.href);
  const isCoursePage = pageUrl.pathname.includes("/course/view.php") && pageUrl.searchParams.has("id");
  if (location.hostname !== "elearning.unimib.it" || !isCoursePage) {
    return { error: "Apri la pagina del corso Moodle prima di avviare la scansione." };
  }

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

  for (const anchor of main.querySelectorAll("a[href]")) {
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

  return (async () => {
    for (const [folderUrl, folderLabel] of folderPages) {
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
    }

    const items = [...found.values()];
    for (let index = 0; index < items.length; index += 4) {
      await Promise.all(items.slice(index, index + 4).map(resolveResourceExtension));
    }
    const title = document.querySelector("#page-header h1, [data-region='page-header'] h1, h1")?.textContent?.trim() || "corso-moodle";
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
  const showProgress = (message, error = false) => {
    panel.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    if (error) text.style.color = "#a11932";
    panel.append(text);
  };

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

  function uniqueName(name, used) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    const count = (used.get(name.toLowerCase()) || 0) + 1;
    used.set(name.toLowerCase(), count);
    return count === 1 ? name : `${base} (${count})${extension}`;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc ^= bytes[index];
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeZip(entries) {
    if (entries.length > 65535) throw new Error("Lo ZIP classico supporta al massimo 65.535 file.");
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const year = Math.min(2107, Math.max(1980, now.getFullYear()));
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const bytes = entry.bytes;
      if (nameBytes.length > 65535 || bytes.length > 0xffffffff || localOffset > 0xffffffff) {
        throw new Error("Un file supera i limiti del formato ZIP classico.");
      }
      const checksum = crc32(bytes);
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
      showProgress(`Recupero file ${index + 1} di ${selectedFiles.length}: ${file.label || "materiale"}…`);
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
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 0xffffffff || totalBytes + bytes.length > 0xffffffff) {
          throw new Error("L’archivio supererebbe il limite di 4 GB del formato ZIP classico.");
        }
        totalBytes += bytes.length;
        const name = uniqueName(responseFilename(response, file), usedNames);
        entries.push({ name, bytes });
      } catch (error) {
        failed.push({ label: String(file.label || "File"), reason: error.message || "errore" });
      }
    }

    if (!entries.length) throw new Error("Non è stato possibile recuperare nessuno dei file selezionati.");
    showProgress(`Creo l’archivio ZIP con ${entries.length} file…`);
    const blob = makeZip(entries);
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

    return {
      ok: true,
      archiveName,
      included: entries.length,
      totalBytes,
      failed
    };
  } catch (error) {
    showProgress(error.message || "Creazione dello ZIP non riuscita.", true);
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

function updateCount() {
  const checkboxes = [...fileList.querySelectorAll("input[type=checkbox]")];
  const visible = checkboxes.filter((checkbox) => !checkbox.closest(".file-row").hidden);
  const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
  const selectedVisible = visible.filter((checkbox) => checkbox.checked).length;
  countLabel.textContent = `${selected} selezionati · ${selectedVisible} nel filtro`;
  downloadButton.disabled = selected === 0;
  downloadButton.textContent = selected ? `Crea ZIP (${selected})` : "Crea ZIP dei selezionati";
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

function applyExtensionFilter() {
  const selectedExtension = extensionFilter.value;
  fileList.querySelectorAll(".file-row").forEach((row) => {
    row.hidden = selectedExtension !== "all" && row.dataset.extension !== selectedExtension;
  });
  updateCount();
}

function renderFiles() {
  fileList.replaceChildren();
  populateExtensionFilter();
  files.forEach((file, index) => {
    const row = document.createElement("label");
    row.className = "file-row";
    row.dataset.extension = file.extension || "unknown";
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
  applyExtensionFilter();
  updateCount();
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  resultsSection.hidden = true;
  files = [];
  setStatus("Sto cercando i file nella pagina e nelle cartelle Moodle…");
  try {
    const tab = await getCourseTab();
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: scanMoodleCourse
    });
    if (!result?.result) throw new Error("La scansione non ha restituito risultati.");
    if (result.result.error) throw new Error(result.result.error);

    files = result.result.files || [];
    courseTitle = result.result.title || "corso-moodle";
    renderFiles();
    const folderNote = result.result.folderErrors?.length
      ? ` Alcune cartelle non sono state lette (${result.result.folderErrors.length}).`
      : "";
    if (files.length) {
      const detectedTypes = new Set(files.map((file) => file.extension).filter(Boolean)).size;
      setStatus(`Trovati ${files.length} file con ${detectedTypes} tipi di estensione rilevati.${folderNote} Filtra e seleziona cosa scaricare.`);
    } else {
      setStatus(`Non ho trovato file Moodle standard in questa pagina.${folderNote} Prova a espandere le sezioni del corso e a scansionare di nuovo.`, true);
    }
  } catch (error) {
    setStatus(error.message || "Scansione non riuscita.", true);
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

extensionFilter.addEventListener("change", applyExtensionFilter);

downloadButton.addEventListener("click", async () => {
  const selected = [...fileList.querySelectorAll("input[type=checkbox]:checked")]
    .map((checkbox) => files[Number(checkbox.dataset.index)])
    .filter(Boolean);
  if (!selected.length) return;

  downloadButton.disabled = true;
  setStatus(`Recupero ${selected.length} file e preparo l’archivio ZIP… lascia aperta questa finestra.`);
  try {
    const tab = await getCourseTab();
    const safeTitle = courseTitle
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "corso-moodle";
    const archiveName = `Materiali_${safeTitle}.zip`;
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: createCourseZip,
      args: [selected, archiveName]
    });
    const result = execution?.result;
    if (!result?.ok) throw new Error(result?.error || "Non è stato possibile creare l’archivio.");
    const omitted = result.failed?.length || 0;
    setStatus(`Archivio ZIP pronto con ${result.included} file${omitted ? `; ${omitted} non inclusi` : ""}. Se il download non parte, usa il link comparso nella pagina del corso.`);
  } catch (error) {
    setStatus(error.message || "Non è stato possibile creare lo ZIP.", true);
  } finally {
    downloadButton.disabled = false;
  }
});
