(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const number = value => value.toLocaleString("ru-RU");
  let result = null, downloadURL = null, filename = "book.json";

  function showStatus(message, progress) {
    $("status").textContent = message;
    $("status").className = "";
    if (typeof progress === "number") $("progress").value = progress;
  }

  function clear() {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    result = null; downloadURL = null;
    $("result").hidden = true;
    $("sample").hidden = true;
    $("jsonSample").value = "";
    $("copyStatus").textContent = "";
  }

  function option(value, text) {
    const node = document.createElement("option");
    node.value = String(value);
    node.textContent = text;
    return node;
  }

  function selectParagraph() {
    if (!result) return;
    const book = result.book;
    const chapter = book.chapters[Number($("chapter").value)];
    const paragraph = chapter.paragraphs[Number($("paragraph").value)];
    $("jsonSample").value = JSON.stringify({
      sample: true, formatVersion: book.formatVersion, bookId: book.bookId,
      title: book.title, author: book.author, processing: book.processing,
      chapter: { id: chapter.id, title: chapter.title }, paragraph,
    }, null, 2);
    $("copyStatus").textContent = "";
  }

  function selectChapter() {
    const chapter = result.book.chapters[Number($("chapter").value)];
    $("paragraph").replaceChildren(...chapter.paragraphs.map((paragraph, i) => {
      const text = paragraph.sentences.map(sentence => sentence.text).join(" ");
      return option(i, `${i + 1}. ${text.slice(0, 85)}${text.length > 85 ? "…" : ""}`);
    }));
    const firstText = chapter.paragraphs.findIndex(paragraph => paragraph.kind === "text");
    $("paragraph").value = String(firstText >= 0 ? firstText : 0);
    selectParagraph();
  }

  function render() {
    const { book, blob, warnings } = result;
    downloadURL = URL.createObjectURL(blob);
    $("bookTitle").textContent = book.title;
    $("bookMeta").textContent = `${book.author || "Автор не указан"} · ${book.language} · JSON v${book.formatVersion}`;
    $("bookId").textContent = book.bookId;
    $("fileSize").textContent = `${(blob.size / 1024 / 1024).toFixed(2)} МиБ · вся книга, компактный JSON`;
    $("stats").replaceChildren();
    for (const [key, label] of [["chapters", "Разделов"], ["paragraphs", "Абзацев"], ["sentences", "Предложений"], ["words", "Слов"], ["uniqueWords", "Уникальных ключей"]]) {
      const group = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = number(book.stats[key]);
      group.append(dt, dd); $("stats").append(group);
    }
    $("warnings").hidden = warnings.length === 0;
    $("warnings").open = false;
    $("warningsTitle").textContent = `Замечания при обработке: ${warnings.length}`;
    $("warningsList").replaceChildren(...warnings.map(message => {
      const li = document.createElement("li"); li.textContent = message; return li;
    }));
    $("chapter").replaceChildren(...book.chapters.map((chapter, i) => option(i, `${i + 1}. ${chapter.title || "Без заголовка"}`)));
    selectChapter();
    $("result").hidden = false;
    $("sample").hidden = false;
  }

  $("file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    clear();
    $("fileName").textContent = file.name;
    $("file").disabled = true;
    $("progress").hidden = false;
    $("progress").max = 1;
    $("progress").value = 0;
    try {
      if (!/\.epub$/i.test(file.name)) throw new Error("Выбери файл с расширением .epub.");
      if (!window.BookPreparer) throw new Error("Не удалось загрузить обработчик. Оставь HTML, JS-файлы и папку vendor вместе в tools.");
      filename = `${file.name.replace(/\.epub$/i, "")}.json`;
      result = await BookPreparer.convert(file, showStatus);
      render();
    } catch (error) {
      clear();
      $("status").textContent = error.message || "Не удалось обработать книгу.";
      $("status").className = "error";
    } finally {
      $("progress").hidden = true;
      $("file").disabled = false;
      $("file").value = ""; // The same file can be selected again after editing it.
    }
  });
  $("chapter").addEventListener("change", selectChapter);
  $("paragraph").addEventListener("change", selectParagraph);
  $("download").addEventListener("click", () => {
    if (!downloadURL) return;
    const link = document.createElement("a");
    link.href = downloadURL; link.download = filename;
    document.body.append(link); link.click(); link.remove();
  });
  $("copy").addEventListener("click", async () => {
    const value = $("jsonSample").value;
    try {
      await navigator.clipboard.writeText(value);
      $("copyStatus").textContent = "Фрагмент скопирован.";
    } catch (_) {
      $("jsonSample").focus(); $("jsonSample").select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch (_) {}
      $("copyStatus").textContent = copied ? "Фрагмент скопирован." : "Фрагмент выделен — нажми ⌘C или Ctrl+C.";
    }
  });
})();
