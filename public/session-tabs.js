(() => {
    'use strict';
    const tabs = Array.from(document.querySelectorAll('.session-tabs [role="tab"]'));
    function selectTab(selected, focus = false) {
        for (const tab of tabs) {
            const active = tab === selected;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
        }
        if (focus) selected.focus();
    }
    const requested = new URLSearchParams(location.search).get('tab') || location.hash.slice(1);
    const initial = tabs.find(tab => tab.id === requested + '-tab');
    if (initial) selectTab(initial);
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            selectTab(tabs[next], true);
        });
    });
})();
