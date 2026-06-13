(function (global) {
  function createBlockManager() {
    const blocks = new Map();
    let lastAddedId = null;

    function addMany(newBlocks) {
      newBlocks.forEach((block) => {
        if (!blocks.has(block.id)) {
          // Scan chunks arrive in document order, so the chain approximates
          // the reading order; used for context-enhanced translation.
          block.prevId = lastAddedId;
          lastAddedId = block.id;
          blocks.set(block.id, block);
        }
      });
    }

    function get(id) {
      return blocks.get(id);
    }

    function all() {
      return Array.from(blocks.values());
    }

    function pendingFromIds(ids) {
      return ids
        .map((id) => blocks.get(id))
        .filter((block) => block && block.status === "pending");
    }

    function idsWithStatus(status) {
      const ids = [];
      blocks.forEach((block) => {
        if (block.status === status) {
          ids.push(block.id);
        }
      });
      return ids;
    }

    function counts() {
      const result = {
        total: 0,
        pending: 0,
        queued: 0,
        translating: 0,
        translated: 0,
        error: 0,
        skipped: 0
      };
      blocks.forEach((block) => {
        result.total += 1;
        if (result[block.status] !== undefined) {
          result[block.status] += 1;
        }
      });
      return result;
    }

    return {
      addMany,
      get,
      all,
      pendingFromIds,
      idsWithStatus,
      counts
    };
  }

  global.PaperTranslatorBlockManager = {
    createBlockManager
  };
})(globalThis);
