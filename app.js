import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { collection, deleteDoc, doc, getFirestore, onSnapshot, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { firebaseConfig, firebaseConfigReady } from "./firebase-config.js";

(() => {
  const STORAGE_KEY = "my-library.books.v1";
  const THEME_KEY = "my-library.theme.v1";
  const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
  const ACTIVITY_STORAGE_KEY = "my-library.last-activity.v1";
  const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];
  const LOCATIONS = ["Home", "Work", "Loaned", "Unknown"];
  const PALETTES = [
    ["#6c9c73", "#e5eee5"], ["#c97960", "#f3e7e0"], ["#c4a46b", "#f4efdf"],
    ["#708c9f", "#e6edf0"], ["#88769a", "#eee9f2"], ["#6f8e83", "#e7eeeb"]
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {
    grid: $("#book-grid"), empty: $("#empty-state"), emptyTitle: $("#empty-title"), emptyCopy: $("#empty-copy"),
    search: $("#search-input"), sort: $("#sort-select"), heading: $("#books-heading"), headingCount: $("#heading-count"),
    dialog: $("#book-dialog"), form: $("#book-form"), details: $("#details-dialog"), csvFile: $("#csv-file"),
    activeFilter: $("#active-filter"), toast: $("#toast"), signIn: $("#sign-in-button"), signOut: $("#sign-out-button"),
    authUser: $("#auth-user"), storageText: $("#storage-text"), bookBelt: $("#book-belt")
  };
  const themeButton = $("#theme-toggle");
  const themeMeta = $("meta[name='theme-color']");

  function applyTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    themeButton.textContent = nextTheme === "dark" ? "☼" : "☾";
    themeButton.setAttribute("aria-label", `Switch to ${nextTheme === "dark" ? "light" : "dark"} theme`);
    themeButton.title = `Switch to ${nextTheme === "dark" ? "light" : "dark"} theme`;
    themeButton.setAttribute("aria-pressed", String(nextTheme === "dark"));
    if (themeMeta) themeMeta.content = nextTheme === "dark" ? "#0d151b" : "#f7f5ef";
    try { localStorage.setItem(THEME_KEY, nextTheme); } catch { /* Theme still works for this page. */ }
  }

  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
  } catch { /* Use the default dark theme. */ }
  applyTheme(document.documentElement.dataset.theme);

  let books = [];
  let localBooks = loadBooks();
  let selectedLocation = "all";
  let toastTimer;
  let activeBookId = null;
  let currentUser = null;
  let firestore = null;
  let auth = null;
  let stopBookListener = null;
  let authPersistenceReady = Promise.resolve();
  let idleLogoutTimer = null;
  let lastActivityAt = Date.now();
  let lastActivitySharedAt = 0;
  const firebaseReady = firebaseConfigReady();

  function loadBooks() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(isValidBook).map(normalizeBook) : [];
    } catch {
      return [];
    }
  }

  function isValidBook(book) {
    return book && typeof book.title === "string" && book.title.trim().length > 0;
  }

  function normalizeBook(book) {
    const location = LOCATIONS.includes(book.location) ? book.location : "Home";
    return {
      id: String(book.id || makeId()),
      title: String(book.title || "").trim().slice(0, 200),
      author: String(book.author || "").trim().slice(0, 200),
      isbn: String(book.isbn || "").trim().slice(0, 30),
      location,
      description: String(book.description || "").trim().slice(0, 1000),
      tags: Array.isArray(book.tags) ? book.tags.map(String).slice(0, 30) : String(book.tags || "").split(",").map(tag => tag.trim()).filter(Boolean).slice(0, 30),
      createdAt: book.createdAt || new Date().toISOString(),
      updatedAt: book.updatedAt || ""
    };
  }

  function makeId() {
    return globalThis.crypto?.randomUUID?.() || `book-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
      localBooks = books.map(book => ({ ...book, tags: [...book.tags] }));
      return true;
    } catch {
      showToast("Couldn’t save. This browser may be out of storage space.");
      return false;
    }
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function locationLabel(location) {
    return ({ Home: "At home", Work: "At work", Loaned: "Loaned out", Unknown: "Other" })[location] || "At home";
  }

  function getVisibleBooks() {
    const query = els.search.value.trim().toLocaleLowerCase();
    const filtered = books.filter(book => {
      const matchesLocation = selectedLocation === "all" || book.location === selectedLocation;
      const haystack = [book.title, book.author, book.isbn, book.description, ...book.tags].join(" ").toLocaleLowerCase();
      return matchesLocation && (!query || haystack.includes(query));
    });
    const sort = els.sort.value;
    return filtered.sort((a, b) => {
      if (sort === "recent") return new Date(b.createdAt) - new Date(a.createdAt);
      if (sort === "author") return (a.author || "\uffff").localeCompare(b.author || "\uffff") || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }

  function render() {
    updateCounts();
    const visible = getVisibleBooks();
    const label = selectedLocation === "all" ? "All books" : locationLabel(selectedLocation);
    $("#breadcrumb-current").textContent = label;
    els.heading.childNodes[0].textContent = `${label} `;
    els.headingCount.textContent = visible.length;
    renderActiveFilter();
    renderBookBelt(visible);
    els.grid.innerHTML = visible.map((book, index) => cardMarkup(book, index)).join("");
    els.grid.hidden = visible.length === 0;
    els.empty.hidden = visible.length !== 0;
    if (books.length === 0) {
      els.emptyTitle.textContent = firebaseReady && !currentUser ? "Sign in to see your library." : "Your collection starts here.";
      els.emptyCopy.textContent = firebaseReady && !currentUser
        ? "Your books are stored securely in your account. Sign in with Google to sync across devices."
        : "Add your first book and give it a place in your personal catalog.";
      $("#empty-add").hidden = firebaseReady && !currentUser;
    } else {
      els.emptyTitle.textContent = "No books found.";
      els.emptyCopy.textContent = "Try a different search or location, or clear your filters to see your collection.";
      $("#empty-add").hidden = true;
    }
    $$(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.location === selectedLocation));
  }

  function renderBookBelt(visible) {
    const section = $("#book-belt-section");
    const controls = $("#book-belt-controls");
    const previousScroll = els.bookBelt.scrollLeft;
    section.hidden = visible.length === 0;
    controls.hidden = visible.length < 2;
    $("#book-belt-count").textContent = `${visible.length} ${visible.length === 1 ? "title" : "titles"}`;
    els.bookBelt.innerHTML = visible.map((book, index) => {
      const [accent] = PALETTES[index % PALETTES.length];
      const author = book.author ? escapeHTML(book.author) : "Author not listed";
      return `<button class="belt-book" type="button" data-book-id="${escapeHTML(book.id)}" style="--belt-accent:${accent}" aria-label="Open ${escapeHTML(book.title)} by ${author}">
        <span class="belt-book-spine" aria-hidden="true"><span>✳</span></span>
        <span class="belt-book-copy"><span class="belt-book-title">${escapeHTML(book.title)}</span><span class="belt-book-author">${author}</span></span>
        <span class="belt-book-arrow" aria-hidden="true">↗</span>
      </button>`;
    }).join("");
    if (visible.length) {
      requestAnimationFrame(() => {
        els.bookBelt.scrollLeft = Math.min(previousScroll, els.bookBelt.scrollWidth - els.bookBelt.clientWidth);
        controls.hidden = visible.length < 2 || els.bookBelt.scrollWidth <= els.bookBelt.clientWidth + 2;
      });
    }
  }

  function cardMarkup(book, index) {
    const [accent, tint] = PALETTES[index % PALETTES.length];
    const tags = book.tags.slice(0, 3).map(tag => `<span class="book-tag">${escapeHTML(tag)}</span>`).join("");
    const author = book.author ? `by ${escapeHTML(book.author)}` : "Author not listed";
    return `<article class="book-card" data-book-id="${escapeHTML(book.id)}" tabindex="0" role="button" aria-label="View ${escapeHTML(book.title)}" style="--book-accent:${accent};--book-tint:${tint}">
      <div class="book-card-head"><span class="book-glyph" aria-hidden="true">✳</span><button class="card-menu-button" type="button" data-action="quick-edit" data-book-id="${escapeHTML(book.id)}" aria-label="Edit ${escapeHTML(book.title)}">···</button></div>
      <h3 class="book-title">${escapeHTML(book.title)}</h3><p class="book-author">${author}</p>
      ${tags ? `<div class="book-tags">${tags}</div>` : ""}
      <div class="book-meta-row"><span class="location-badge" data-location="${escapeHTML(book.location)}">${escapeHTML(locationLabel(book.location))}</span><span class="isbn-short">${book.isbn ? `ISBN ${escapeHTML(book.isbn)}` : ""}</span></div>
    </article>`;
  }

  function updateCounts() {
    $("#count-all").textContent = books.length;
    $("#stat-total").textContent = books.length;
    for (const location of LOCATIONS) {
      const count = books.filter(book => book.location === location).length;
      const key = location.toLowerCase();
      $(`#count-${key}`).textContent = count;
      const stat = $(`#stat-${key}`);
      if (stat) stat.textContent = count;
    }
  }

  function renderActiveFilter() {
    const hasSearch = els.search.value.trim().length > 0;
    const hasLocation = selectedLocation !== "all";
    if (!hasSearch && !hasLocation) {
      els.activeFilter.hidden = true;
      return;
    }
    els.activeFilter.hidden = false;
    const parts = [];
    if (hasSearch) parts.push(`Matching “${escapeHTML(els.search.value.trim())}”`);
    if (hasLocation) parts.push(locationLabel(selectedLocation));
    els.activeFilter.innerHTML = `${parts.join(" · ")} <button type="button" class="clear-filter" id="clear-filters">Clear filters</button>`;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 3000);
  }

  function updateAuthUI(user) {
    const signedIn = Boolean(user);
    els.signIn.hidden = signedIn || !firebaseReady;
    els.signOut.hidden = !signedIn;
    els.authUser.hidden = !signedIn;
    els.authUser.classList.toggle("auth-user", signedIn);
    els.authUser.textContent = signedIn ? (user.displayName || user.email || "Signed in") : "";
    if (firebaseReady) {
      els.storageText.textContent = signedIn ? "Synced to your Google account" : "Sign in to sync your library";
    } else {
      els.storageText.textContent = "Saved on this device";
      els.signIn.hidden = true;
      els.signOut.hidden = true;
      els.authUser.hidden = true;
    }
  }

  function stopIdleLogoutTimer() {
    window.clearTimeout(idleLogoutTimer);
    idleLogoutTimer = null;
  }

  function scheduleIdleLogout() {
    stopIdleLogoutTimer();
    if (!currentUser || !auth) return;
    const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt);
    if (remaining <= 0) {
      void signOutForInactivity();
      return;
    }
    idleLogoutTimer = window.setTimeout(signOutForInactivity, remaining);
  }

  async function signOutForInactivity() {
    if (!currentUser || !auth) return;
    if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) {
      scheduleIdleLogout();
      return;
    }
    try {
      await signOut(auth);
      showToast("Signed out after 2 minutes of inactivity.");
    } catch (error) {
      console.error(error);
      showToast("Automatic sign-out didn’t complete. Please sign out manually.");
    }
  }

  function recordActivity() {
    if (!currentUser) return;
    lastActivityAt = Date.now();
    scheduleIdleLogout();
    if (lastActivityAt - lastActivitySharedAt < 5000) return;
    lastActivitySharedAt = lastActivityAt;
    try { localStorage.setItem(ACTIVITY_STORAGE_KEY, String(lastActivityAt)); } catch { /* Storage may be disabled. */ }
  }

  function handleSharedActivity(event) {
    if (!currentUser || event.key !== ACTIVITY_STORAGE_KEY) return;
    const activityAt = Number(event.newValue);
    if (!Number.isFinite(activityAt) || activityAt <= lastActivityAt) return;
    lastActivityAt = activityAt;
    scheduleIdleLogout();
  }

  for (const eventName of ACTIVITY_EVENTS) {
    window.addEventListener(eventName, recordActivity, { passive: true });
  }
  window.addEventListener("storage", handleSharedActivity);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentUser) scheduleIdleLogout();
  });

  function openForm(book = null) {
    if (firebaseReady && !currentUser) return showToast("Sign in with Google to manage your cloud library.");
    els.form.reset();
    $("#book-id").value = book?.id || "";
    $("#modal-title").textContent = book ? "Edit book" : "Add a book";
    $("#save-book").innerHTML = book ? "Save changes" : '<span class="plus-icon" aria-hidden="true">+</span> Save book';
    $("#book-title").value = book?.title || "";
    $("#book-author").value = book?.author || "";
    $("#book-isbn").value = book?.isbn || "";
    $("#book-location").value = book?.location || "Home";
    $("#book-tags").value = (book?.tags || []).join(", ");
    $("#book-description").value = book?.description || "";
    els.dialog.showModal();
    window.setTimeout(() => $("#book-title").focus(), 0);
  }

  function openDetails(id) {
    const book = books.find(item => item.id === id);
    if (!book) return;
    activeBookId = id;
    $("#details-title").textContent = book.title;
    $("#details-author").textContent = book.author || "Author not listed";
    const location = $("#details-location");
    location.textContent = locationLabel(book.location);
    location.dataset.location = book.location;
    const details = [
      ["ISBN", book.isbn || "Not listed", false],
      ["Added", formatDate(book.createdAt), false],
      ["Tags", book.tags.join(", ") || "None", false],
      ["Notes", book.description || "No notes yet.", true]
    ];
    $("#details-list").innerHTML = details.map(([label, value, wide]) => `<div${wide ? ' class="wide"' : ""}><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join("");
    els.details.showModal();
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date not recorded";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function cloudCollection() {
    return collection(firestore, "users", currentUser.uid, "books");
  }

  function cloudRecord(book) {
    const { title, author, isbn, location, description, tags, createdAt, updatedAt } = book;
    return { title, author, isbn, location, description, tags, createdAt, updatedAt };
  }

  function duplicateKey(book) {
    if (book.isbn) return `isbn:${book.isbn.replace(/[^\da-z]/gi, "").toLowerCase()}`;
    return `title:${book.title.trim().toLocaleLowerCase()}|${book.author.trim().toLocaleLowerCase()}`;
  }

  async function migrateLocalBooks(ref, cloudBooks) {
    if (!localBooks.length) return;
    const cloudIds = new Set(cloudBooks.map(book => book.id));
    const cloudKeys = new Set(cloudBooks.map(duplicateKey));
    const missing = localBooks.filter(book => !cloudIds.has(book.id) && !cloudKeys.has(duplicateKey(book)));
    if (!missing.length) return;
    const choice = window.confirm(
      cloudBooks.length === 0
        ? `I found ${localBooks.length} book${localBooks.length === 1 ? "" : "s"} saved in this browser. Upload them to your Google account so they sync across devices? The local copy will stay here as a backup.`
        : `I found ${missing.length} additional book${missing.length === 1 ? "" : "s"} saved in this browser. Upload them to your Google account? The local copy will stay here as a backup.`
    );
    if (!choice) return;
    try {
      for (let start = 0; start < missing.length; start += 450) {
        const batch = writeBatch(firestore);
        for (const book of missing.slice(start, start + 450)) {
          batch.set(doc(ref, book.id), cloudRecord(book));
        }
        await batch.commit();
      }
      showToast(`${missing.length} book${missing.length === 1 ? "" : "s"} uploaded to your library.`);
    } catch (error) {
      console.error(error);
      showToast("The upload didn’t finish. Your local copy is still saved here.");
    }
  }

  function attachCloudLibrary(user) {
    if (stopBookListener) stopBookListener();
    currentUser = user;
    updateAuthUI(user);
    if (!user) {
      stopIdleLogoutTimer();
      books = firebaseReady ? [] : localBooks;
      render();
      return;
    }
    lastActivityAt = Date.now();
    scheduleIdleLogout();
    const ref = cloudCollection();
    let firstSnapshot = true;
    stopBookListener = onSnapshot(ref, snapshot => {
      const cloudBooks = snapshot.docs.map(item => normalizeBook({ ...item.data(), id: item.id }));
      books = cloudBooks;
      render();
      if (firstSnapshot) {
        firstSnapshot = false;
        void migrateLocalBooks(ref, cloudBooks);
      }
    }, error => {
      console.error(error);
      showToast("Couldn’t load your cloud library. Check the Firestore rules in the README.");
    });
  }

  async function saveBook(event) {
    event.preventDefault();
    if (!els.form.reportValidity()) return;
    const id = $("#book-id").value;
    const previous = books.find(book => book.id === id);
    const book = normalizeBook({
      id: id || makeId(),
      title: $("#book-title").value,
      author: $("#book-author").value,
      isbn: $("#book-isbn").value,
      location: $("#book-location").value,
      tags: $("#book-tags").value.split(",").map(tag => tag.trim()).filter(Boolean),
      description: $("#book-description").value,
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    try {
      if (currentUser) await setDoc(doc(firestore, "users", currentUser.uid, "books", book.id), cloudRecord(book));
      else {
        books = previous ? books.map(item => item.id === id ? book : item) : [...books, book];
        if (!persistLocal()) return;
      }
      els.dialog.close();
      if (!currentUser) render();
      showToast(previous ? "Book details updated." : "Book added to your collection.");
    } catch (error) {
      console.error(error);
      showToast("Couldn’t save the book. Your browser copy is unchanged.");
    }
  }

  async function deleteBook(id) {
    const book = books.find(item => item.id === id);
    if (!book) return;
    if (!window.confirm(`Remove “${book.title}” from your collection?`)) return;
    try {
      if (currentUser) await deleteDoc(doc(firestore, "users", currentUser.uid, "books", id));
      else {
        books = books.filter(item => item.id !== id);
        if (!persistLocal()) return;
        render();
      }
      els.details.close();
      showToast("Book removed from your collection.");
    } catch (error) {
      console.error(error);
      showToast("Couldn’t delete the book. Please try again.");
    }
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCSV() {
    if (books.length === 0) return showToast("Add a book before exporting your collection.");
    const headers = ["Title", "Author", "ISBN", "Location", "Description", "Tags"];
    const rows = books.map(book => [book.title, book.author, book.isbn, book.location, book.description, book.tags.join(", ")]);
    downloadFile("my-library-books.csv", [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
    showToast("Your book list has been exported.");
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(cell); cell = ""; }
      else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else cell += char;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
    return rows.filter(items => items.some(value => value.trim() !== ""));
  }

  async function importCSV(file) {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return showToast("That CSV doesn’t contain any book rows.");
    const headers = rows.shift().map(value => value.trim().replace(/^\uFEFF/, "").toLowerCase());
    const titleIndex = headers.indexOf("title");
    if (titleIndex < 0) return showToast("The CSV needs a Title column.");
    const index = name => headers.indexOf(name);
    const imported = [];
    rows.forEach((row, rowIndex) => {
      const value = col => col < 0 ? "" : (row[col] || "").trim();
      const title = value(titleIndex);
      if (!title) return;
      const rawLocation = value(index("location"));
      const locationMatch = LOCATIONS.find(location => location.toLowerCase() === rawLocation.toLowerCase());
      imported.push(normalizeBook({
        title, author: value(index("author")), isbn: value(index("isbn")), location: locationMatch || "Home",
        description: value(index("description")), tags: value(index("tags")).split(",").map(tag => tag.trim()).filter(Boolean),
        createdAt: new Date(Date.now() + rowIndex).toISOString()
      }));
    });
    if (!imported.length) return showToast("No valid books were found. Each row needs a title.");
    try {
      if (currentUser) {
        for (let start = 0; start < imported.length; start += 450) {
          const batch = writeBatch(firestore);
          for (const book of imported.slice(start, start + 450)) {
            batch.set(doc(firestore, "users", currentUser.uid, "books", book.id), cloudRecord(book));
          }
          await batch.commit();
        }
      } else {
        books = [...books, ...imported];
        if (!persistLocal()) return;
        render();
      }
      showToast(`${imported.length} ${imported.length === 1 ? "book" : "books"} imported.`);
    } catch (error) {
      console.error(error);
      showToast("The import didn’t finish. Please try again.");
    }
  }

  function downloadFile(filename, content, type) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\uFEFF", content], { type }));
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  $("#add-book").addEventListener("click", () => openForm());
  $("#empty-add").addEventListener("click", () => openForm());
  $("#close-dialog").addEventListener("click", () => els.dialog.close());
  $("#cancel-dialog").addEventListener("click", () => els.dialog.close());
  $("#close-details").addEventListener("click", () => els.details.close());
  $("#details-done").addEventListener("click", () => els.details.close());
  els.form.addEventListener("submit", saveBook);
  els.search.addEventListener("input", render);
  els.sort.addEventListener("change", render);
  $("#location-nav").addEventListener("click", event => {
    const button = event.target.closest("button[data-location]");
    if (!button) return;
    selectedLocation = button.dataset.location;
    render();
  });
  els.activeFilter.addEventListener("click", event => {
    if (!event.target.closest("#clear-filters")) return;
    els.search.value = "";
    selectedLocation = "all";
    render();
    els.search.focus();
  });
  els.grid.addEventListener("click", event => {
    const edit = event.target.closest('[data-action="quick-edit"]');
    if (edit) {
      event.stopPropagation();
      const book = books.find(item => item.id === edit.dataset.bookId);
      if (book) openForm(book);
      return;
    }
    const card = event.target.closest(".book-card");
    if (card) openDetails(card.dataset.bookId);
  });
  els.grid.addEventListener("keydown", event => {
    const card = event.target.closest(".book-card");
    if (card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openDetails(card.dataset.bookId);
    }
  });
  els.bookBelt.addEventListener("click", event => {
    const item = event.target.closest(".belt-book");
    if (item) openDetails(item.dataset.bookId);
  });
  els.bookBelt.addEventListener("keydown", event => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      els.bookBelt.scrollBy({ left: event.key === "ArrowRight" ? 260 : -260, behavior: "smooth" });
    }
  });
  const scrollBookBelt = direction => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    els.bookBelt.scrollBy({ left: direction * Math.max(240, els.bookBelt.clientWidth * 0.72), behavior });
  };
  $("#belt-prev").addEventListener("click", () => scrollBookBelt(-1));
  $("#belt-next").addEventListener("click", () => scrollBookBelt(1));
  themeButton.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#edit-book").addEventListener("click", () => {
    const book = books.find(item => item.id === activeBookId);
    if (!book) return;
    els.details.close();
    openForm(book);
  });
  $("#delete-book").addEventListener("click", () => deleteBook(activeBookId));
  $("#import-trigger").addEventListener("click", () => els.csvFile.click());
  $("#export-trigger").addEventListener("click", exportCSV);
  els.csvFile.addEventListener("change", async () => {
    const file = els.csvFile.files?.[0];
    if (file) await importCSV(file);
    els.csvFile.value = "";
  });
  els.signIn.addEventListener("click", async () => {
    if (!auth) return showToast("Cloud sign-in isn’t configured yet.");
    try {
      await authPersistenceReady;
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
      showToast(error.code === "auth/unauthorized-domain" ? "Add ggkhub.github.io to Firebase’s authorized domains." : "Google sign-in didn’t complete. Please try again.");
    }
  });
  els.signOut.addEventListener("click", async () => {
    if (!auth) return;
    try { await signOut(auth); } catch (error) { console.error(error); showToast("Sign out didn’t complete."); }
  });
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.search.focus();
    }
  });

  // Render a 360-degree equirectangular panorama directly in WebGL; no viewer library required.
  const libraryPhoto = $("#library-photo");
  const panoramaCanvas = $("#panorama-canvas");
  const panoramaImage = libraryPhoto.querySelector(".library-photo-image");
  let panoramaGl = null;
  let panoramaTexture = null;
  let panoramaProgram = null;
  let panoramaYaw = 0;
  let panoramaPitch = 0;
  let photoDrag = null;
  const paintPanorama = () => {
    if (!panoramaGl || !panoramaProgram) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(libraryPhoto.clientWidth * ratio));
    const height = Math.max(1, Math.round(libraryPhoto.clientHeight * ratio));
    if (panoramaCanvas.width !== width || panoramaCanvas.height !== height) {
      panoramaCanvas.width = width;
      panoramaCanvas.height = height;
    }
    panoramaGl.viewport(0, 0, width, height);
    panoramaGl.useProgram(panoramaProgram);
    panoramaGl.uniform2f(panoramaGl.getUniformLocation(panoramaProgram, "u_resolution"), width, height);
    panoramaGl.uniform2f(panoramaGl.getUniformLocation(panoramaProgram, "u_angles"), panoramaYaw, panoramaPitch);
    panoramaGl.activeTexture(panoramaGl.TEXTURE0);
    panoramaGl.bindTexture(panoramaGl.TEXTURE_2D, panoramaTexture);
    panoramaGl.drawArrays(panoramaGl.TRIANGLE_STRIP, 0, 4);
  };
  const setupPanorama = () => {
    if (!panoramaImage.complete || !panoramaImage.naturalWidth || panoramaGl) return;
    const gl = panoramaCanvas.getContext("webgl", { alpha: false, antialias: true });
    if (!gl) return;
    const vertexSource = `attribute vec2 a_position; void main(){ gl_Position=vec4(a_position,0.0,1.0); }`;
    const fragmentSource = `
      precision mediump float;
      uniform sampler2D u_panorama;
      uniform vec2 u_resolution;
      uniform vec2 u_angles;
      const float PI=3.141592653589793;
      void main(){
        vec2 screen=(gl_FragCoord.xy/u_resolution)*2.0-1.0;
        screen.x*=u_resolution.x/u_resolution.y;
        vec3 ray=normalize(vec3(screen,1.32));
        float cp=cos(u_angles.y), sp=sin(u_angles.y);
        ray=vec3(ray.x,ray.y*cp-ray.z*sp,ray.y*sp+ray.z*cp);
        float cy=cos(u_angles.x), sy=sin(u_angles.x);
        ray=vec3(ray.x*cy+ray.z*sy,ray.y,-ray.x*sy+ray.z*cy);
        float longitude=atan(ray.x,ray.z);
        float latitude=asin(clamp(ray.y,-1.0,1.0));
        vec2 uv=vec2(fract(0.5+longitude/(2.0*PI)),0.5+latitude/PI);
        gl_FragColor=texture2D(u_panorama,uv);
      }`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panoramaImage);
    gl.uniform1i(gl.getUniformLocation(program, "u_panorama"), 0);
    panoramaGl = gl;
    panoramaTexture = texture;
    panoramaProgram = program;
    libraryPhoto.classList.add("is-ready");
    paintPanorama();
  };
  if (panoramaImage.complete && panoramaImage.naturalWidth) setupPanorama();
  else panoramaImage.addEventListener("load", setupPanorama, { once: true });
  if ("ResizeObserver" in window) new ResizeObserver(paintPanorama).observe(libraryPhoto);
  else window.addEventListener("resize", paintPanorama);

  libraryPhoto.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    photoDrag = { x: event.clientX, y: event.clientY, yaw: panoramaYaw, pitch: panoramaPitch };
    libraryPhoto.setPointerCapture(event.pointerId);
    libraryPhoto.classList.add("is-dragging");
  });
  libraryPhoto.addEventListener("pointermove", event => {
    if (!photoDrag) return;
    panoramaYaw = photoDrag.yaw - ((event.clientX - photoDrag.x) / Math.max(1, libraryPhoto.clientWidth)) * Math.PI * 2;
    panoramaPitch = Math.max(-1.25, Math.min(1.25, photoDrag.pitch + ((event.clientY - photoDrag.y) / Math.max(1, libraryPhoto.clientHeight)) * Math.PI));
    paintPanorama();
  });
  const endPhotoDrag = event => {
    if (!photoDrag) return;
    photoDrag = null;
    libraryPhoto.classList.remove("is-dragging");
    if (event?.pointerId !== undefined && libraryPhoto.hasPointerCapture(event.pointerId)) libraryPhoto.releasePointerCapture(event.pointerId);
  };
  libraryPhoto.addEventListener("pointerup", endPhotoDrag);
  libraryPhoto.addEventListener("pointercancel", endPhotoDrag);
  libraryPhoto.addEventListener("keydown", event => {
    const step = Math.PI / 18;
    if (event.key === "ArrowLeft") panoramaYaw -= step;
    else if (event.key === "ArrowRight") panoramaYaw += step;
    else if (event.key === "ArrowUp") panoramaPitch = Math.max(-1.25, panoramaPitch - step);
    else if (event.key === "ArrowDown") panoramaPitch = Math.min(1.25, panoramaPitch + step);
    else return;
    event.preventDefault();
    paintPanorama();
  });
  $("#photo-reset").addEventListener("click", () => {
    panoramaYaw = 0;
    panoramaPitch = 0;
    paintPanorama();
  });

  $("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());

  if (firebaseReady) {
    try {
      const firebaseApp = initializeApp(firebaseConfig);
      auth = getAuth(firebaseApp);
      firestore = getFirestore(firebaseApp);
      authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(error => {
        console.error(error);
        showToast("This browser couldn’t remember your sign-in. Check its privacy or storage settings.");
      });
      onAuthStateChanged(auth, attachCloudLibrary);
    } catch (error) {
      console.error(error);
      showToast("Firebase setup has a configuration issue. Check firebase-config.js.");
    }
  } else {
    books = localBooks;
    attachCloudLibrary(null);
  }
  updateAuthUI(null);
  render();
})();

