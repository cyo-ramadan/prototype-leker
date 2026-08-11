(() => {
  function cleanOrderMeta() {
    document.querySelectorAll('.customer-meta').forEach(node => {
      const text = String(node.textContent || '');
      const [customerName] = text.split(' · ');
      if (customerName) node.textContent = customerName;
    });
  }
  const observer = new MutationObserver(cleanOrderMeta);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', cleanOrderMeta);
  cleanOrderMeta();
})();
