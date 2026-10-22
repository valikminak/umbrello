/* Read sections: Learn words (read.html) and Books (books.html), keeping the chosen profile. */
(function () {
  "use strict";
  const id = new URLSearchParams(location.search).get("user");
  document.querySelectorAll(".read-tabs a[data-page]").forEach(link => {
    const params = new URLSearchParams({ v: "7" });
    // Unknown profiles are redirected by the page script; only a well-formed ID is copied.
    if (id && /^[a-z0-9-]+$/.test(id)) params.set("user", id);
    link.href = `${link.dataset.page}?${params}`;
  });
})();
