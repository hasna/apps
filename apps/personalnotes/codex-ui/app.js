(function () {
  'use strict';

  const appWindow = document.querySelector('.app-window');
  const viewTitle = document.getElementById('view-title');
  const navItems = Array.from(document.querySelectorAll('[data-view]'));
  const prompt = document.getElementById('prompt');
  const composer = document.getElementById('composer');
  const sendButton = composer.querySelector('.send-button');
  const searchDialog = document.getElementById('search-dialog');
  const searchInput = document.getElementById('search-input');

  function isMobile() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function setSidebar(open) {
    if (isMobile()) {
      appWindow.classList.toggle('sidebar-open', open);
    } else {
      appWindow.classList.toggle('sidebar-collapsed', !open);
    }

    document.querySelectorAll('[data-action="toggle-sidebar"]').forEach(button => {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-expanded', String(open));
    });
  }

  function openSearch() {
    searchDialog.hidden = false;
    requestAnimationFrame(() => searchInput.focus());
  }

  function closeSearch() {
    searchDialog.hidden = true;
    searchInput.value = '';
  }

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action && action.dataset.action === 'toggle-sidebar') {
      const currentlyOpen = isMobile()
        ? appWindow.classList.contains('sidebar-open')
        : !appWindow.classList.contains('sidebar-collapsed');
      setSidebar(!currentlyOpen);
      return;
    }

    if (action && action.dataset.action === 'search') {
      openSearch();
      return;
    }

    if (event.target === searchDialog) closeSearch();
  });

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(candidate => candidate.classList.remove('is-active'));
      item.classList.add('is-active');
      viewTitle.textContent = item.dataset.view;
      if (isMobile()) setSidebar(false);
    });
  });

  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(prompt.scrollHeight, 150) + 'px';
    sendButton.disabled = !prompt.value.trim();
  });

  composer.addEventListener('submit', event => {
    event.preventDefault();
    if (!prompt.value.trim()) return;
    viewTitle.textContent = 'New task';
    prompt.value = '';
    prompt.style.height = 'auto';
    sendButton.disabled = true;
  });

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (event.key === 'Escape' && !searchDialog.hidden) closeSearch();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) appWindow.classList.remove('sidebar-open');
  });
})();
