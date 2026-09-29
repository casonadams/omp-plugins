// Theme, copy-to-clipboard, and interactive filters for omp-plugins showcase
(function () {
  "use strict";

  const STORAGE_KEY = "omp-plugins:theme";

  // Theme Management
  function getPreferredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    updateThemeIcon(theme);
  }

  function updateThemeIcon(theme) {
    const sunIcon = document.getElementById("themeIconSun");
    const moonIcon = document.getElementById("themeIconMoon");
    if (!sunIcon || !moonIcon) return;

    if (theme === "dark") {
      sunIcon.style.display = "block";
      moonIcon.style.display = "none";
    } else {
      sunIcon.style.display = "none";
      moonIcon.style.display = "block";
    }
  }

  function initTheme() {
    const currentTheme = getPreferredTheme();
    applyTheme(currentTheme);

    const toggleBtn = document.getElementById("themeToggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(nextTheme);
      });
    }

    // Listen to OS preference changes if user hasn't explicitly set preference
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? "dark" : "light");
      }
    });
  }

  // Copy to Clipboard
  function copyTextToClipboard(text, onSuccess, onError) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
      return;
    }

    // Fallback for older browsers or non-secure contexts
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (successful) {
        onSuccess();
      } else {
        onError();
      }
    } catch (err) {
      onError(err);
    }
  }

  function initCopyButtons() {
    document.querySelectorAll(".btn-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const command = btn.getAttribute("data-copy");
        if (!command) return;

        const originalText = btn.innerHTML;
        copyTextToClipboard(
          command,
          () => {
            btn.classList.add("copied");
            btn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Copied!</span>
            `;
            setTimeout(() => {
              btn.classList.remove("copied");
              btn.innerHTML = originalText;
            }, 1800);
          },
          () => {
            btn.innerText = "Failed";
            setTimeout(() => {
              btn.innerHTML = originalText;
            }, 1500);
          },
        );
      });
    });
  }

  // Category Filtering
  function initCategoryFilters() {
    const filterButtons = document.querySelectorAll(".filter-btn");
    const pluginCards = document.querySelectorAll(".plugin-card");

    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const category = btn.getAttribute("data-category");

        filterButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        pluginCards.forEach((card) => {
          const cardCategory = card.getAttribute("data-category");
          if (category === "all" || cardCategory === category) {
            card.style.display = "flex";
          } else {
            card.style.display = "none";
          }
        });
      });
    });
  }

  // Initialize all interactive modules on DOMContentLoaded
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initCopyButtons();
    initCategoryFilters();
  });
})();
