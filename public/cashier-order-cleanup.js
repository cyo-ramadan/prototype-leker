(() => {
  function cleanOrderMeta() {
    document.querySelectorAll('.customer-meta').forEach(node => {
      const text = String(node.textContent || '');
      const [customerName] = text.split(' · ');
      if (customerName && text !== customerName) node.textContent = customerName;
    });
  }

  // MutationObserver callbacks must be idempotent. Writing the same textContent
  // on every callback creates a self-triggering microtask loop that can lock the
  // cashier UI after order cards are rendered.
  const observer = new MutationObserver(cleanOrderMeta);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', cleanOrderMeta);
  cleanOrderMeta();
})();
