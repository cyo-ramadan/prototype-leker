(() => {
  const MASTER_VISUAL_PREFIX = 'LEKER_V1:';
  const baseB64 = typeof window !== 'undefined' ? window.LEKER_ASSET_BASE_B64 : '';
  const spriteB64 = typeof window !== 'undefined' ? window.LEKER_ASSET_SPRITE_B64 : '';
  const BASE_URL = baseB64 ? `data:image/webp;base64,${baseB64}` : '';
  const SPRITE_URL = spriteB64 ? `data:image/webp;base64,${spriteB64}` : '';
  const SPRITES = Object.freeze({
    chocolate: Object.freeze({ column: 0, row: 0 }),
    milk: Object.freeze({ column: 1, row: 0 }),
    cheese: Object.freeze({ column: 2, row: 0 }),
    blueberry: Object.freeze({ column: 3, row: 0 }),
    strawberry: Object.freeze({ column: 4, row: 0 }),
    oreo: Object.freeze({ column: 0, row: 1 }),
    chocchips: Object.freeze({ column: 1, row: 1 }),
    banana: Object.freeze({ column: 2, row: 1 }),
    peanut: Object.freeze({ column: 3, row: 1 }),
    sprinkles: Object.freeze({ column: 4, row: 1 }),
    marshmallow: Object.freeze({ column: 0, row: 2 }),
    cappuccino: Object.freeze({ column: 1, row: 2 }),
    matcha: Object.freeze({ column: 2, row: 2 }),
    palm_sugar: Object.freeze({ column: 3, row: 2 }),
    egg: Object.freeze({ column: 4, row: 2 }),
    corned_beef: Object.freeze({ column: 0, row: 3 }),
    corn: Object.freeze({ column: 1, row: 3 }),
    sausage: Object.freeze({ column: 2, row: 3 }),
    blue_band: Object.freeze({ column: 3, row: 3 }),
    tiramisu: Object.freeze({ column: 4, row: 3 })
  });

  const normalizeName = value => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/|,+-]+/g, ' ')
    .replace(/\s+/g, ' ');

  function resolveToppings(value) {
    const name = normalizeName(value);
    const toppings = [];
    let matched = /\bleker\b|\boriginal\b|\bori\b/.test(name);
    const add = key => {
      matched = true;
      if (SPRITES[key] && !toppings.includes(key)) toppings.push(key);
    };

    if (/special\s*maxi/.test(name)) {
      add('chocolate');
      add('cheese');
      add('banana');
      return toppings;
    }
    if (/double\s*choco/.test(name)) {
      add('chocolate');
      add('chocchips');
      return toppings;
    }

    if (/choco\s*crunch/.test(name)) add('chocchips');
    if (/choco\s*maltine|chocomaltine/.test(name)) add('chocolate');
    if (/ovomaltine/.test(name)) add('chocolate');
    if (/beng\s*beng/.test(name)) add('chocolate');
    if (/tiramisu/.test(name)) add('tiramisu');
    if (/\bnutella\b|\bnuttela\b/.test(name)) add('chocolate');
    if (/\bmilo\b/.test(name)) {
      add('chocolate');
      add('milk');
    }

    const hasSpecificChocolate = /choco\s*crunch|choco\s*maltine|chocomaltine|ovomaltine|beng\s*beng/.test(name);
    if ((/\bcokelat\b|\bcoklat\b|\bchoco\b|\bchocolate\b/.test(name)) && !hasSpecificChocolate) add('chocolate');
    if (/\bsusu\b|\bmilk\b/.test(name)) add('milk');
    if (/\bvanila\b|\bvanilla\b/.test(name)) add('milk');
    if (/\bmeses\b|\bsprinkle/.test(name)) add('sprinkles');
    if (/\bmozarella\b|\bmozzarella\b/.test(name)) add('cheese');
    if (/\bkeju\b|\bcheese\b/.test(name)) add('cheese');
    if (/\bblueberry\b/.test(name)) add('blueberry');
    if (/\bstrawberry\b/.test(name)) add('strawberry');
    if (/\bblue\s*band\b|\bmargarin/.test(name)) add('blue_band');
    if (/\bgula(?:\s*aren)?\b|\bpalm\s*sugar\b/.test(name)) add('palm_sugar');
    if (/\boreo\b/.test(name)) add('oreo');
    if (/\bchoco\s*chips?\b|\bchocochips?\b/.test(name)) add('chocchips');
    if (/\bgreen\s*tea\b|\bgreentea\b|\bmatcha\b/.test(name)) add('matcha');
    if (/\bcappu?c+ino\b|\bcoffee\b|\bkopi\b/.test(name)) add('cappuccino');
    if (/\bkacang\b|\bpeanut\b/.test(name)) add('peanut');
    if (/\bmarsmellow\b|\bmarshm+allow\b|\bmarshmallow\b/.test(name)) add('marshmallow');
    if (/\bpisang\b|\bbanana\b/.test(name)) add('banana');
    if (/\btel+or\b|\btelur\b|\begg\b/.test(name)) add('egg');
    if (/\bkornet\b|\bcorned\s*beef\b/.test(name)) add('corned_beef');
    if (/\bjagung\b|\bcorn\b/.test(name)) add('corn');
    if (/\bsosis\b|\bsausage\b/.test(name)) add('sausage');
    if (/\bmayo\b|\bmayonaise\b|\bmayonnaise\b/.test(name)) add('milk');

    return matched ? toppings.slice(0, 3) : [];
  }

  function recognizes(value) {
    const name = normalizeName(value);
    if (/\bleker\b|\boriginal\b|\bori\b/.test(name)) return true;
    return resolveToppings(name).length > 0;
  }

  function visualNameFromKey(value) {
    const key = String(value || '').trim();
    return key.startsWith(MASTER_VISUAL_PREFIX) ? key.slice(MASTER_VISUAL_PREFIX.length).trim() : '';
  }

  function toppingMarkup(key, index) {
    const sprite = SPRITES[key];
    if (!sprite) return '';
    return `<span class="leker-generated-topping leker-generated-topping-${index + 1}" style="--leker-sprite-x:${sprite.column};--leker-sprite-y:${sprite.row}" aria-hidden="true"></span>`;
  }

  function artMarkup(value) {
    if (!BASE_URL || !SPRITE_URL || !recognizes(value)) return '';
    const toppings = resolveToppings(value);
    return `<div class="menu-product-image leker-menu-generated" data-leker-generated="1">
      <img class="leker-generated-base" src="${BASE_URL}" alt="" aria-hidden="true">
      <div class="leker-generated-toppings leker-generated-count-${toppings.length}" aria-hidden="true">
        ${toppings.map(toppingMarkup).join('')}
      </div>
    </div>`;
  }

  function artMarkupForVisualKey(value, fallbackName = '') {
    const visualName = visualNameFromKey(value);
    return artMarkup(visualName || fallbackName);
  }

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById('lekerMenuVisualStyles')) return;
    const style = document.createElement('style');
    style.id = 'lekerMenuVisualStyles';
    style.textContent = `
      .leker-menu-generated{position:relative;display:block;width:100%;aspect-ratio:1/1;overflow:hidden;background:#f4dfbf}
      .leker-menu-generated .leker-generated-base{display:block;width:100%;height:100%;object-fit:cover}
      .leker-generated-toppings{position:absolute;right:1.5%;bottom:3.5%;width:31.25%;height:31.25%;pointer-events:none}
      .leker-generated-topping{position:absolute;bottom:0;left:50%;display:block;width:70%;aspect-ratio:1/1;background-image:url('${SPRITE_URL}');background-size:500% 400%;background-repeat:no-repeat;background-position:calc(var(--leker-sprite-x) * -100%) calc(var(--leker-sprite-y) * -100%);filter:drop-shadow(0 3px 3px rgba(67,38,18,.24));transform-origin:50% 100%}
      .leker-generated-count-1 .leker-generated-topping{width:82%;transform:translateX(-50%)}
      .leker-generated-count-2 .leker-generated-topping{width:68%}
      .leker-generated-count-2 .leker-generated-topping-1{transform:translateX(-82%) rotate(-4deg)}
      .leker-generated-count-2 .leker-generated-topping-2{transform:translateX(-18%) rotate(4deg)}
      .leker-generated-count-3 .leker-generated-topping{width:56%}
      .leker-generated-count-3 .leker-generated-topping-1{transform:translateX(-102%) rotate(-6deg)}
      .leker-generated-count-3 .leker-generated-topping-2{transform:translateX(-50%) translateY(-7%)}
      .leker-generated-count-3 .leker-generated-topping-3{transform:translateX(2%) rotate(6deg)}
    `;
    document.head.appendChild(style);
  }

  function productForName(value) {
    if (typeof state === 'undefined' || !Array.isArray(state.menu)) return null;
    const normalized = normalizeName(value);
    return state.menu.find(item => normalizeName(item.name) === normalized) || null;
  }

  function hasExplicitImage(imageNode, product) {
    if (product?.imageData) return true;
    if (!imageNode || imageNode.tagName !== 'IMG') return false;
    const source = String(imageNode.getAttribute('src') || '').trim();
    return Boolean(source && !source.endsWith('/default-product.svg') && source !== '/default-product.svg');
  }

  function decorateCard(card) {
    if (!card || card.dataset.lekerVisualReady === '1') return;
    const nameNode = card.querySelector('.menu-product-name, h3');
    const imageNode = card.querySelector('.menu-product-image');
    const productName = nameNode?.textContent || '';
    const product = productForName(productName);
    if (!imageNode) return;

    // Product Master image_data is authoritative. The generated visual is only
    // the built-in fallback represented by image_visual_key.
    if (hasExplicitImage(imageNode, product)) {
      card.dataset.lekerVisualReady = '1';
      card.dataset.lekerVisualSource = 'product-image';
      return;
    }

    const markup = product?.imageVisualKey
      ? artMarkupForVisualKey(product.imageVisualKey, productName)
      : artMarkup(productName);
    if (!markup) return;
    const holder = document.createElement('div');
    holder.innerHTML = markup.trim();
    const replacement = holder.firstElementChild;
    if (!replacement) return;
    imageNode.replaceWith(replacement);
    card.dataset.lekerVisualReady = '1';
    card.dataset.lekerVisualSource = product?.imageVisualKey ? 'master-visual-key' : 'legacy-name-fallback';
  }

  function decorateMenu() {
    if (typeof document === 'undefined') return;
    installStyles();
    const grid = document.getElementById('menuGrid');
    if (!grid) return;
    grid.querySelectorAll('.menu-card').forEach(decorateCard);
    if (grid.dataset.lekerVisualObserver === '1') return;
    grid.dataset.lekerVisualObserver = '1';
    const observer = new MutationObserver(() => {
      grid.querySelectorAll('.menu-card').forEach(decorateCard);
    });
    observer.observe(grid, { childList: true, subtree: true });
  }

  const api = Object.freeze({
    MASTER_VISUAL_PREFIX,
    BASE_URL,
    SPRITE_URL,
    SPRITES,
    normalizeName,
    resolveToppings,
    recognizes,
    visualNameFromKey,
    artMarkup,
    artMarkupForVisualKey,
    decorateMenu
  });

  if (typeof window !== 'undefined') {
    window.LekerMenuVisuals = api;
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('leker-menu-visuals-ready'));
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateMenu, { once: true });
    else decorateMenu();
  }
})();
