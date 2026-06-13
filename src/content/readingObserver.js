(function (global) {
  function createReadingObserver(onVisible) {
    const visibleIds = new Set();
    let flushTimer = 0;

    function scheduleFlush() {
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        if (visibleIds.size > 0) {
          onVisible(Array.from(visibleIds));
          visibleIds.clear();
        }
      }, 120);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let added = false;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.dataset.paperTranslatorBlock;
          if (id) {
            visibleIds.add(id);
            added = true;
          }
          // A block only needs to be noticed once; dropping it keeps the
          // observer cheap on pages with thousands of paragraphs.
          observer.unobserve(entry.target);
        });
        if (added) scheduleFlush();
      },
      {
        root: null,
        rootMargin: "900px 0px 1200px 0px",
        threshold: 0
      }
    );

    function observe(blocks) {
      blocks.forEach((block) => observer.observe(block.element));
    }

    function disconnect() {
      observer.disconnect();
      window.clearTimeout(flushTimer);
    }

    return {
      observe,
      disconnect
    };
  }

  global.PaperTranslatorReadingObserver = {
    createReadingObserver
  };
})(globalThis);
