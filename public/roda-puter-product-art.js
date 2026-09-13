(() => {
  const ICON_SPRITE = '/roda-puter-tea-icons.webp?v=20260908-v3';
  const PRODUCT_ICON_INDEX = new Map([
    ['es teh matcha besar', 0],
    ['es teh milktea lemon honey besar', 1],
    ['es teh poci jasmine', 2],
    ['es milktea leci besar', 3],
    ['es milktea apel besar', 4],
    ['es milktea blackcurrant besar', 5],
    ['es milktea orange besar', 6],
    ['es milktea mangga besar', 7],
    ['es teh milktea besar', 8],
    ['es teh thaitea besar', 9],
    ['es teh cappuccino besar', 10],
    ['es teh coklat besar', 11],
    ['es teh leci besar', 12],
    ['es teh apel besar', 13],
    ['es teh lemon honey besar', 14],
    ['es teh blackcurrant besar', 15],
    ['es teh orange besar', 16],
    ['es teh mangga besar', 17],
    ['es teh poci original vanilla besar', 18]
  ]);

  function normalizeProductName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/milk\s*tea/g, 'milktea')
      .replace(/black\s*cur+ant|black\s*currant|black\s*curent/g, 'blackcurrant')
      .replace(/cap+uc+ino|cappuc+ino/g, 'cappuccino')
      .replace(/\s+/g, ' ');
  }

  function rewardIconKind(value) {
    const name = normalizeProductName(value);
    if (name.includes('leker')) return 'LEKER';
    if (/(^|\s)(es\s+)?teh(\s|$)|tea|milktea|thai\s*tea|matcha|cappuccino|coklat|coffee|kopi|minuman|drink/.test(name)) return 'DRINK';
    return 'GIFT';
  }

  function rewardSymbolMarkup(kind) {
    if (kind === 'LEKER') {
      return `
        <svg class="roda-reward-symbol roda-reward-symbol-leker" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <path d="M11 14 54 24 27 55Z" fill="#f7cf7a" stroke="#7c3f16" stroke-width="3" stroke-linejoin="round"/>
          <path d="M11 14 35 31 54 24" fill="#ffe5a8" stroke="#a65b22" stroke-width="2.4" stroke-linejoin="round"/>
          <path d="M35 31 27 55" stroke="#a65b22" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="28" cy="24" r="3.4" fill="#7c2d12"/>
          <circle cx="38" cy="27" r="3" fill="#7c2d12"/>
          <circle cx="25" cy="33" r="2.5" fill="#7c2d12"/>
          <path d="M18 18c8 2 14 4 20 7" stroke="#fff4ce" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
        </svg>`;
    }

    if (kind === 'DRINK') {
      return `
        <svg class="roda-reward-symbol roda-reward-symbol-drink" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <path d="M38 5 31 17" stroke="#7c2d12" stroke-width="4" stroke-linecap="round"/>
          <path d="M18 17h30l-4 39H22Z" fill="#fff6dc" stroke="#7c2d12" stroke-width="3" stroke-linejoin="round"/>
          <path d="M21 28h24l-2.6 25H23.6Z" fill="#b91c1c" opacity=".92"/>
          <path d="M20 22h26" stroke="#d4a72c" stroke-width="3" stroke-linecap="round"/>
          <circle cx="29" cy="38" r="3" fill="#f5c95c"/>
          <circle cx="37" cy="44" r="2.5" fill="#f5c95c"/>
          <path d="M27 14h12" stroke="#d4a72c" stroke-width="3" stroke-linecap="round"/>
        </svg>`;
    }

    return `
      <svg class="roda-reward-symbol roda-reward-symbol-gift" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path d="M10 25h44v31H10Z" fill="#b91c1c" stroke="#7c2d12" stroke-width="3"/>
        <path d="M7 20h50v11H7Z" fill="#f4d466" stroke="#7c2d12" stroke-width="3"/>
        <path d="M28 20h8v36h-8Z" fill="#f4d466"/>
        <path d="M31 20c-10-1-14-6-11-10 4-5 10 1 12 8m1 2c10-1 14-6 11-10-4-5-10 1-12 8" fill="none" stroke="#7c2d12" stroke-width="3" stroke-linecap="round"/>
      </svg>`;
  }

  function installRodaProductArtStyle() {
    if (document.getElementById('rodaPuterProductArtStyle')) return;
    const style = document.createElement('style');
    style.id = 'rodaPuterProductArtStyle';
    style.textContent = `
      .roda-demo{border-color:#e8c767;background:linear-gradient(145deg,#fff9e7 0%,#fff 58%,#fff3cf 100%);box-shadow:0 18px 44px rgba(124,45,18,.13)}
      .roda-stage{min-height:330px}
      .roda-wheel{box-sizing:border-box;width:min(80vw,300px);overflow:hidden;isolation:isolate;border:8px solid #e7bf45;outline:4px solid #8b4513;box-shadow:0 0 0 3px #fff1a8,0 17px 34px rgba(91,33,8,.27),inset 0 0 24px rgba(92,45,5,.2)}
      .roda-wheel::before{content:'';position:absolute;inset:4px;border-radius:50%;z-index:0;pointer-events:none;border:2px solid rgba(255,241,168,.88);box-shadow:inset 0 0 18px rgba(78,35,4,.2),inset 0 0 0 2px rgba(127,29,29,.24)}
      .roda-reward-token{position:absolute;left:50%;top:50%;z-index:5;pointer-events:none;transform-origin:center;border:2px solid #f2d36d;border-radius:50%;overflow:hidden;background:#fff8df;box-sizing:border-box;box-shadow:0 2px 8px rgba(67,20,7,.34);filter:drop-shadow(0 2px 2px rgba(67,20,7,.24));display:grid;place-items:center}
      .roda-reward-sprite{position:absolute;display:block;width:500%;height:400%;max-width:none;max-height:none}
      .roda-reward-direct{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%;background:#fff4cf}
      .roda-reward-symbol{display:block;width:82%;height:82%}
      .roda-reward-symbol-leker{width:88%;height:88%}
      .roda-reward-token .leker-menu-generated{width:100%;height:100%;aspect-ratio:1/1;border-radius:50%;overflow:hidden}
      .roda-reward-token .leker-menu-generated .leker-generated-base{width:100%;height:100%;object-fit:cover}
      .roda-spin{width:88px;border:6px solid #f4d466;outline:2px solid #8b5b16;background:radial-gradient(circle at 34% 27%,#ef4444 0 10%,#c91f1f 42%,#8f1515 100%);color:#fff7d6;text-shadow:0 1px 0 #6b120f;box-shadow:0 5px 16px rgba(67,20,7,.4),inset 0 2px 4px rgba(255,255,255,.3)}
      .roda-spin:hover{background:radial-gradient(circle at 34% 27%,#f45b5b 0 10%,#d52b2b 42%,#991b1b 100%)}
      .roda-pointer{top:-9px;border-left-width:20px;border-right-width:20px;border-top-width:40px;border-top-color:#b91c1c;filter:drop-shadow(0 -2px 0 #f4d466) drop-shadow(0 4px 2px rgba(67,20,7,.35))}
      .roda-prize{border-color:#ecd68f;background:#fffaf0;color:#7c2d12}
      @media(max-width:760px){.roda-stage{min-height:310px}}
    `;
    document.head.appendChild(style);
  }

  function liveRewards() {
    if (typeof state !== 'undefined' && Array.isArray(state.rodaRewards) && state.rodaRewards.length) {
      return state.rodaRewards.map(reward => ({
        productId: reward.productId,
        name: reward.productName,
        weightBasisPoints: Number(reward.weightBasisPoints || 0),
        weightPercent: Number(reward.weightBasisPoints || 0) / 100
      }));
    }

    return [...document.querySelectorAll('#rodaPuterPrizes .roda-prize')].map(pill => {
      const text = pill.textContent.trim();
      const splitAt = text.lastIndexOf(' · ');
      const weightPercent = Number((splitAt >= 0 ? text.slice(splitAt + 3) : '0').replace('%', '').replace(',', '.')) || 0;
      return {
        productId: '',
        name: splitAt >= 0 ? text.slice(0, splitAt) : text,
        weightBasisPoints: Math.round(weightPercent * 100),
        weightPercent
      };
    });
  }

  function wheelGradient(rewards) {
    const colors = ['#b91c1c', '#fff1bf'];
    const stops = [];
    let cursor = 0;
    rewards.forEach((reward, index) => {
      const start = cursor;
      const end = Math.min(100, start + reward.weightPercent);
      const divider = Math.min(.22, Math.max(.08, reward.weightPercent * .06));
      const bodyStart = Math.min(end, start + divider);
      const bodyEnd = Math.max(bodyStart, end - divider);
      stops.push(`#d3a423 ${start}% ${bodyStart}%`);
      stops.push(`${colors[index % colors.length]} ${bodyStart}% ${bodyEnd}%`);
      stops.push(`#d3a423 ${bodyEnd}% ${end}%`);
      cursor = end;
    });
    if (cursor < 100) stops.push(`#fff1bf ${cursor}% 100%`);
    return `conic-gradient(${stops.join(',')})`;
  }

  function menuProductForReward(reward) {
    if (typeof state === 'undefined' || !Array.isArray(state.menu)) return null;
    const byId = reward.productId
      ? state.menu.find(item => String(item.id) === String(reward.productId))
      : null;
    if (byId) return byId;
    const normalized = normalizeProductName(reward.name);
    return state.menu.find(item => normalizeProductName(item.name) === normalized) || null;
  }

  function setSymbolFallback(token, reward) {
    token.replaceChildren();
    token.insertAdjacentHTML('afterbegin', rewardSymbolMarkup(rewardIconKind(reward.name)));
    token.dataset.artSource = `symbol:${rewardIconKind(reward.name).toLowerCase()}`;
  }

  function setTeaSprite(token, reward) {
    const iconIndex = PRODUCT_ICON_INDEX.get(normalizeProductName(reward.name));
    if (iconIndex == null) return false;
    const column = iconIndex % 5;
    const row = Math.floor(iconIndex / 5);
    const image = document.createElement('img');
    image.className = 'roda-reward-sprite';
    image.src = ICON_SPRITE;
    image.alt = '';
    image.style.left = `-${column * 100}%`;
    image.style.top = `-${row * 100}%`;
    image.addEventListener('error', () => setSymbolFallback(token, reward), { once: true });
    token.replaceChildren(image);
    token.dataset.artSource = 'tea-sprite';
    return true;
  }

  function setMasterVisual(token, reward, product) {
    if (!product?.imageVisualKey) return false;
    const api = typeof window !== 'undefined' ? window.LekerMenuVisuals : null;
    const markup = api?.artMarkupForVisualKey?.(product.imageVisualKey, product.name || reward.name) || '';
    if (!markup) {
      token.dataset.awaitingMasterVisual = '1';
      return false;
    }
    token.innerHTML = markup;
    token.dataset.artSource = 'master-visual-key';
    delete token.dataset.awaitingMasterVisual;
    return true;
  }

  function setNonImageFallback(token, reward, product) {
    if (setMasterVisual(token, reward, product)) return;
    if (setTeaSprite(token, reward)) return;
    setSymbolFallback(token, reward);
  }

  function applyProductArt(token, reward) {
    const product = menuProductForReward(reward);

    // Product Master is authoritative: a real image_data wins over every
    // compatibility sprite or generated symbol.
    if (product?.imageData) {
      const image = document.createElement('img');
      image.className = 'roda-reward-direct';
      image.src = product.imageData;
      image.alt = '';
      image.addEventListener('error', () => setNonImageFallback(token, reward, product), { once: true });
      token.replaceChildren(image);
      token.dataset.artSource = 'product-image';
      return;
    }

    setNonImageFallback(token, reward, product);
  }

  function tokenSizeForRewardCount(count) {
    if (count <= 4) return 56;
    if (count <= 8) return 44;
    if (count <= 12) return 36;
    return 29;
  }

  function rewardArtSignature(rewards) {
    return rewards.map(reward => {
      const product = menuProductForReward(reward);
      const masterSource = product?.imageData
        ? `image:${String(product.imageData).length}`
        : `key:${product?.imageVisualKey || ''}`;
      return `${reward.productId}:${reward.name}:${reward.weightBasisPoints}:${masterSource}`;
    }).join('|');
  }

  function decorateRodaPuter(force = false) {
    const wheel = document.getElementById('rodaPuterWheel');
    const rewards = liveRewards();
    if (!wheel || !rewards.length) return false;

    const signature = rewardArtSignature(rewards);
    if (!force && wheel.dataset.productArtSignature === signature && Number(wheel.dataset.productArtCount || 0) === rewards.length) return true;

    wheel.querySelectorAll('.roda-reward-token').forEach(token => token.remove());
    wheel.dataset.productArtSignature = signature;
    wheel.dataset.productArtCount = String(rewards.length);
    wheel.style.background = `radial-gradient(circle at 35% 28%,rgba(255,255,255,.32),transparent 35%),${wheelGradient(rewards)}`;

    const wheelSize = wheel.getBoundingClientRect().width || 280;
    const radialOffset = Math.max(72, Math.min(108, Math.round(wheelSize * 0.35)));
    const tokenSize = Math.min(tokenSizeForRewardCount(rewards.length), Math.max(28, Math.round(wheelSize * 0.19)));
    let cursorBasisPoints = 0;

    rewards.forEach(reward => {
      const weightBasisPoints = reward.weightBasisPoints || Math.round(reward.weightPercent * 100);
      const midpointBasisPoints = cursorBasisPoints + (weightBasisPoints / 2);
      cursorBasisPoints += weightBasisPoints;
      const angle = midpointBasisPoints * 360 / 10000;
      const token = document.createElement('span');
      token.className = 'roda-reward-token';
      token.dataset.productId = String(reward.productId || '');
      token.dataset.iconKind = rewardIconKind(reward.name);
      token.setAttribute('aria-label', reward.name || 'Hadiah Roda Puter');
      token.title = reward.name || 'Hadiah Roda Puter';
      token.style.width = `${tokenSize}px`;
      token.style.height = `${tokenSize}px`;
      token.style.transform = `translate(-50%,-50%) rotate(${angle}deg) translateY(-${radialOffset}px) rotate(${-angle}deg)`;
      applyProductArt(token, reward);
      wheel.appendChild(token);
    });

    return wheel.querySelectorAll('.roda-reward-token').length === rewards.length;
  }

  installRodaProductArtStyle();

  let observer = null;
  const tryDecorate = force => {
    if (!decorateRodaPuter(Boolean(force))) return false;
    if (observer) observer.disconnect();
    return true;
  };

  if (!tryDecorate(false)) {
    observer = new MutationObserver(() => tryDecorate(false));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    [50, 150, 400, 900, 1600].forEach(delay => setTimeout(() => tryDecorate(false), delay));
  }

  window.addEventListener('leker-menu-visuals-ready', () => tryDecorate(true));
  window.addEventListener('resize', () => {
    clearTimeout(decorateRodaPuter.resizeTimer);
    decorateRodaPuter.resizeTimer = setTimeout(() => tryDecorate(true), 120);
  });
})();
