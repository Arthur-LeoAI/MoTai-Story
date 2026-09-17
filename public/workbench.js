"use strict";
(() => {
  const screen = document.querySelector('.editor-screen');
  const shell = document.querySelector('#studioShell');
  const chapterButton = document.querySelector('#toggleChaptersButton');
  const focusButton = document.querySelector('#focusWritingButton');
  const aiPanel = document.querySelector('#editorAiPanel');
  const narrow = () => window.innerWidth < 1100;
  let collapsed = false;
  try { collapsed = localStorage.getItem('motai.ui.chaptersCollapsed') === 'true'; } catch {}
  screen.classList.toggle('chapters-collapsed', collapsed);
  const backdrop = document.createElement('button');
  backdrop.type = 'button'; backdrop.className = 'workbench-backdrop'; backdrop.setAttribute('aria-label','关闭侧栏');
  screen.append(backdrop);
  let lastAiOpen = screen.classList.contains('ai-panel-open');
  function closeDrawers() {
    screen.classList.remove('panel-open', 'ai-panel-open');
    aiPanel.setAttribute('aria-hidden','true');
    sync(); chapterButton.focus();
  }
  function sync() {
    const aiOpen = screen.classList.contains('ai-panel-open');
    if (aiOpen && !lastAiOpen) {
      const target = document.querySelector('#targetWords'), preset = document.querySelector('#targetWordsPreset');
      preset.value = ['300','800','1500'].includes(target.value) ? target.value : 'custom';
      target.classList.toggle('hidden',preset.value !== 'custom');
    }
    if (narrow() && aiOpen && !lastAiOpen) screen.classList.remove('panel-open');
    lastAiOpen = aiOpen;
    const visible = narrow() ? screen.classList.contains('panel-open') : !collapsed && !(aiOpen && window.innerWidth < 1440);
    chapterButton.setAttribute('aria-expanded',String(visible));
    document.querySelector('#toggleEditorAiButton').setAttribute('aria-expanded',String(aiOpen));
    backdrop.classList.toggle('visible', narrow() && (visible || aiOpen));
    const busy = document.querySelector('#generateEditorAiButton').disabled;
    document.querySelector('#cancelWritingTask').classList.toggle('hidden', !busy);
    const checks = [...document.querySelectorAll('input[name="accepted-hunk"]')];
    const accept = document.querySelector('[data-accept-ai-edit]');
    if (accept && state.aiEditResult?.canAccept && !state.aiAccepting) {
      accept.disabled = !checks.some(c => c.checked);
      accept.textContent = accept.disabled ? '请先选择修改段' : '接受选中修改';
    }
  }
  chapterButton.onclick = () => {
    if (narrow()) {
      const opening = !screen.classList.contains('panel-open');
      screen.classList.remove('ai-panel-open'); aiPanel.setAttribute('aria-hidden','true');
      screen.classList.toggle('panel-open',opening);
    } else {
      if (window.innerWidth < 1440) { screen.classList.remove('ai-panel-open'); aiPanel.setAttribute('aria-hidden','true'); }
      collapsed = !collapsed; screen.classList.toggle('chapters-collapsed',collapsed);
      try { localStorage.setItem('motai.ui.chaptersCollapsed',String(collapsed)); } catch {}
    }
    sync();
  };
  document.querySelector('#closeChaptersButton').onclick = closeDrawers;
  backdrop.onclick = closeDrawers;
  focusButton.onclick = () => {
    const focused = shell.classList.toggle('focus-writing');
    focusButton.textContent = focused ? '退出专注' : '专注';
    focusButton.setAttribute('aria-pressed',String(focused));
  };
  document.addEventListener('keydown',e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (shell.classList.contains('focus-writing')) focusButton.click();
    else if (narrow()) closeDrawers();
  });
  const preset = document.querySelector('#targetWordsPreset'), target = document.querySelector('#targetWords');
  preset.onchange = () => { target.classList.toggle('hidden',preset.value !== 'custom'); if(preset.value !== 'custom') target.value = preset.value; else target.focus(); };
  // Scene presets still write the original target input; reflect them without
  // changing the generation contract or keeping a second source of truth.
  document.querySelector('#toggleEditorAiButton').addEventListener('click', () => {
    preset.value = ['300','800','1500'].includes(target.value) ? target.value : 'custom';
    target.classList.toggle('hidden',preset.value !== 'custom');
  });
  document.addEventListener('change',e => { if(e.target.matches('input[name="accepted-hunk"]')) sync(); });
  new MutationObserver(sync).observe(screen,{attributes:true,attributeFilter:['class']});
  new MutationObserver(sync).observe(document.querySelector('#generateEditorAiButton'),{attributes:true,attributeFilter:['disabled']});
  new MutationObserver(sync).observe(document.querySelector('#editorAiBody'),{childList:true});
  window.addEventListener('resize',sync);
  sync();
})();
