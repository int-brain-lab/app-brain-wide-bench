// Generic tab switching: buttons matching `.tab-row .tab[data-tab]` toggle
// visibility of `section[data-tab]` panels sharing the same value. Shared by
// any page using this markup convention (currently model_details.html).
// `root` scopes the lookups (default `document`), so more than one tab group
// can coexist on a page without one's clicks toggling another's sections.

function tabButtons(root) {
  return root.querySelectorAll(".tab-row .tab");
}

function tabSections(root) {
  return root.querySelectorAll("section[data-tab]");
}

function showTab(tabName, root = document) {
  tabButtons(root).forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  tabSections(root).forEach((section) => {
    section.hidden = section.dataset.tab !== tabName;
  });
}

function attachTabEvents(root = document) {
  tabButtons(root).forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab, root));
  });
}

export { showTab, attachTabEvents };
