import { MENU_ITEMS as DEFAULT_MENU, CATEGORIES, HERO_BANNERS as DEFAULT_BANNERS } from './menuData.js';

// Business Rules
const MIN_ORDER_VALUE = 399;

// Dynamic Data Store (with Firestore real-time listeners & fallback)
let dynamicMenuItems = [...DEFAULT_MENU];
let dynamicBanners = [...DEFAULT_BANNERS];

// State
let cart = JSON.parse(localStorage.getItem('thz_cart') || '{}');
let favorites = JSON.parse(localStorage.getItem('thz_favs') || '[]');
let currentCategory = 'all';
let currentSort = 'all';
let searchQuery = '';
let appliedCoupon = null;
let selectedPayment = 'online'; // 'online' (FREE delivery) or 'cod' (₹40 delivery)
let currentTab = 'home';
let heroBannerIndex = 0;
let upiTimerInterval = null;
let upiSecondsRemaining = 300; // 5:00 minutes
let pendingOrderRecord = null;
let liveOrderTrackerInterval = null;

// Google Authentication State
let currentUser = JSON.parse(localStorage.getItem('thz_google_user') || 'null');

// -------------------------------------------------------------------
// 0. FIREBASE REAL-TIME LISTENERS & STORE SYNC
// -------------------------------------------------------------------
let db = null;
try {
  const firebaseConfig = {
    apiKey: "AIzaSyDummyKeyPlaceholderForHungerZone",
    authDomain: "the-hunger-zone.firebaseapp.com",
    projectId: "the-hunger-zone",
    storageBucket: "the-hunger-zone.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
  };

  if (window.firebase && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    // 1. Dynamic Banner Listener: collection 'settings', doc 'banners'
    db.collection('settings').doc('banners').onSnapshot(docSnap => {
      if (docSnap.exists && docSnap.data().banners && Array.isArray(docSnap.data().banners)) {
        dynamicBanners = docSnap.data().banners;
        renderHeroBanner();
      }
    }, err => {
      console.log("Firestore banners using fallback defaults:", err.message);
    });

    // 2. Dynamic Menu Listener: collection 'menu'
    db.collection('menu').onSnapshot(querySnap => {
      if (querySnap && !querySnap.empty) {
        const fetchedItems = [];
        querySnap.forEach(doc => {
          const data = doc.data();
          if (data.isAvailable !== false) {
            fetchedItems.push({ id: doc.id, ...data });
          }
        });
        if (fetchedItems.length > 0) {
          dynamicMenuItems = fetchedItems;
          renderProducts();
          renderFeatured();
        }
      }
    }, err => {
      console.log("Firestore menu using fallback defaults:", err.message);
    });

    // 3. Live Active Orders Listener: collection 'orders'
    setupOrdersFirestoreListener();
  }
} catch (e) {
  console.warn("Firestore running in fallback mode:", e);
}

let firestoreOrdersUnsubscribe = null;
export function setupOrdersFirestoreListener() {
  if (!db) return;
  if (firestoreOrdersUnsubscribe) {
    firestoreOrdersUnsubscribe();
    firestoreOrdersUnsubscribe = null;
  }

  try {
    let ordersRef = db.collection('orders');
    if (currentUser && currentUser.email) {
      // Filter strictly by the currently logged-in user's email
      ordersRef = ordersRef.where('customerEmail', '==', currentUser.email);
    }

    firestoreOrdersUnsubscribe = ordersRef.limit(25).onSnapshot(querySnap => {
      if (querySnap) {
        const firestoreOrders = [];
        querySnap.forEach(doc => {
          firestoreOrders.push({ id: doc.id, ...doc.data() });
        });

        // Merge with local storage
        const localOrders = JSON.parse(localStorage.getItem('thz_orders') || '[]');
        const merged = [...firestoreOrders];
        localOrders.forEach(lo => {
          if (!merged.find(m => m.orderId === lo.orderId)) {
            merged.push(lo);
          }
        });
        localStorage.setItem('thz_orders', JSON.stringify(merged));
        if (currentTab === 'orders') refreshOrdersList();
      }
    }, err => {
      console.log("Firestore user orders sync fallback:", err.message);
    });
  } catch (err) {
    console.warn("Orders listener setup exception:", err);
  }
}
window.setupOrdersFirestoreListener = setupOrdersFirestoreListener;

// -------------------------------------------------------------------
// 1. GOOGLE AUTHENTICATION SYSTEM
// -------------------------------------------------------------------
export function openGoogleAuthModal() {
  document.getElementById('googleAuthModal')?.classList.remove('hidden');
}
window.openGoogleAuthModal = openGoogleAuthModal;

export function closeGoogleAuthModal() {
  document.getElementById('googleAuthModal')?.classList.add('hidden');
}
window.closeGoogleAuthModal = closeGoogleAuthModal;

export function confirmGoogleLogin(email, name, photoURL) {
  currentUser = {
    email: email || 'rk608290@gmail.com',
    name: name || 'Rohit Kumar',
    photoURL: photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
    uid: 'google-' + Math.random().toString(36).substring(2, 9),
    signedInAt: new Date().toISOString()
  };

  localStorage.setItem('thz_google_user', JSON.stringify(currentUser));
  localStorage.setItem('thz_user_name', currentUser.name);

  // Pre-fill Customer fields in checkout
  const custName = document.getElementById('custName');
  if (custName) custName.value = currentUser.name;

  updateAuthUI();
  updateProfileDisplay();
  setupOrdersFirestoreListener();
  refreshOrdersList();
  closeGoogleAuthModal();
  showToast(`Welcome back, ${currentUser.name}! 🌟`);
}
window.confirmGoogleLogin = confirmGoogleLogin;

export function confirmCustomGoogleLogin() {
  const customEmail = document.getElementById('googleCustomEmail')?.value.trim();
  if (!customEmail || !customEmail.includes('@')) {
    showToast('Please enter a valid Google email address');
    return;
  }
  const extractedName = customEmail.split('@')[0].replace(/[._-]/g, ' ');
  const formattedName = extractedName.charAt(0).toUpperCase() + extractedName.slice(1);
  confirmGoogleLogin(customEmail, formattedName, 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80');
}
window.confirmCustomGoogleLogin = confirmCustomGoogleLogin;

export function handleGoogleSignOut() {
  currentUser = null;
  localStorage.removeItem('thz_google_user');
  updateAuthUI();
  updateProfileDisplay();
  setupOrdersFirestoreListener();
  refreshOrdersList();
  showToast('Signed out of Google account');
}
window.handleGoogleSignOut = handleGoogleSignOut;

function updateAuthUI() {
  const headerAuthLabel = document.getElementById('headerAuthLabel');
  const btnHeaderAuth = document.getElementById('btnHeaderGoogleAuth');
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  const profileEmailDisplay = document.getElementById('profileEmailDisplay');
  const profileBadge = document.getElementById('profileBadge');
  const profileDefaultIcon = document.getElementById('profileDefaultIcon');
  const profileUserImg = document.getElementById('profileUserImg');
  const btnSignIn = document.getElementById('btnProfileGoogleSignIn');
  const btnSignOut = document.getElementById('btnProfileSignOut');

  if (currentUser) {
    // Header
    if (headerAuthLabel) headerAuthLabel.textContent = currentUser.name.split(' ')[0];
    if (btnHeaderAuth) {
      btnHeaderAuth.title = `Signed in as ${currentUser.name} (${currentUser.email})`;
      btnHeaderAuth.classList.add('border-amber-400', 'bg-amber-50/50');
    }

    // Profile Card
    if (profileNameDisplay) profileNameDisplay.textContent = currentUser.name;
    if (profileEmailDisplay) profileEmailDisplay.textContent = currentUser.email;
    if (profileBadge) {
      profileBadge.textContent = 'Google Verified Member ★';
      profileBadge.className = 'inline-block text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded';
    }
    if (profileUserImg) {
      profileUserImg.src = currentUser.photoURL;
      profileUserImg.classList.remove('hidden');
    }
    if (profileDefaultIcon) profileDefaultIcon.classList.add('hidden');
    if (btnSignIn) btnSignIn.classList.add('hidden');
    if (btnSignOut) btnSignOut.classList.remove('hidden');

    // Pre-fill checkout
    const custName = document.getElementById('custName');
    if (custName && !custName.value) custName.value = currentUser.name;
  } else {
    // Header
    if (headerAuthLabel) headerAuthLabel.textContent = 'Sign In';
    if (btnHeaderAuth) {
      btnHeaderAuth.title = 'Sign in with Google';
      btnHeaderAuth.classList.remove('border-amber-400', 'bg-amber-50/50');
    }

    // Profile Card
    if (profileNameDisplay) profileNameDisplay.textContent = 'Guest Foodie';
    if (profileEmailDisplay) profileEmailDisplay.textContent = 'Not signed in';
    if (profileBadge) {
      profileBadge.textContent = 'Guest Mode';
      profileBadge.className = 'inline-block text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded';
    }
    if (profileUserImg) profileUserImg.classList.add('hidden');
    if (profileDefaultIcon) profileDefaultIcon.classList.remove('hidden');
    if (btnSignIn) btnSignIn.classList.remove('hidden');
    if (btnSignOut) btnSignOut.classList.add('hidden');
  }
}

// -------------------------------------------------------------------
// 2. DUAL-TONE SYNTHESIZED WEB AUDIO CHIME (FamPay Style)
// -------------------------------------------------------------------
export function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const tones = [
      { freq: 659.25, start: 0, dur: 0.28 },
      { freq: 987.77, start: 0.12, dur: 0.32 },
      { freq: 1318.51, start: 0.24, dur: 0.45 }
    ];

    tones.forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(t.freq, now + t.start);

      gain.gain.setValueAtTime(0, now + t.start);
      gain.gain.linearRampToValueAtTime(0.3, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.05);
    });
  } catch (err) {
    console.warn("Audio chime skipped:", err);
  }
}

// -------------------------------------------------------------------
// 3. CANVAS CONFETTI
// -------------------------------------------------------------------
export function fireConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#F59E0B', '#FBBF24', '#D97706', '#16A34A', '#FFFFFF', '#1F2937'];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      r: Math.random() * 6 + 3,
      d: Math.random() * 90,
      color: colors[Math.floor(Math.random() * colors.length)],
      tiltAngle: 0,
      tiltAngleIncremental: (Math.random() * 0.07) + 0.05,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 16 - 3,
      alpha: 1
    });
  }

  let animationFrame;
  const startTime = Date.now();

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35;
      p.tiltAngle += p.tiltAngleIncremental;
      p.alpha -= 0.012;

      if (p.alpha > 0) {
        active = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    if (active && Date.now() - startTime < 3500) {
      animationFrame = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }

  draw();
}

// -------------------------------------------------------------------
// 4. AUTO-SLIDING HERO BANNER CAROUSEL
// -------------------------------------------------------------------
export function renderHeroBanner() {
  if (dynamicBanners.length === 0) dynamicBanners = [...DEFAULT_BANNERS];
  const banner = dynamicBanners[heroBannerIndex % dynamicBanners.length];
  const container = document.getElementById('heroBannerContent');
  if (!container) return;

  container.innerHTML = `
    <div class="relative z-10 flex items-center justify-between">
      <div class="max-w-[62%]">
        <span class="inline-flex items-center gap-1 bg-amber-500 text-gray-950 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full tracking-wider mb-2 shadow-sm">
          <i class="fa-solid fa-bolt text-[9px]"></i> ${banner.tag}
        </span>
        <h2 class="text-xl font-black tracking-tight leading-tight text-white uppercase">
          ${banner.title}
        </h2>
        <p class="text-[11px] text-gray-300 font-medium mt-1 leading-snug">
          ${banner.subtitle}
        </p>
        <div class="mt-3.5 flex items-center gap-2">
          <button id="heroOrderNow" class="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-gray-950 font-black text-xs px-4 py-2 rounded-full shadow-lg shadow-amber-500/40 flex items-center gap-1.5 tap-bounce transition-all">
            <span>Order Now</span>
            <i class="fa-solid fa-arrow-right text-[11px]"></i>
          </button>
          <span class="text-[10px] font-black text-amber-300 bg-amber-400/15 border border-amber-400/30 px-2 py-1 rounded-full">
            ${banner.badge}
          </span>
        </div>
      </div>

      <div class="relative w-28 h-28 flex items-center justify-center flex-shrink-0">
        <div class="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/40 animate-[spin_20s_linear_infinite]"></div>
        <img 
          src="${banner.image}" 
          alt="${banner.dish || 'Special Dish'}" 
          class="w-24 h-24 object-cover rounded-full shadow-2xl border-2 border-amber-400"
        />
        <div class="absolute -bottom-1 -right-1 bg-amber-500 text-gray-950 text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-md">
          ${banner.price || '₹199'}
        </div>
      </div>
    </div>
  `;

  document.getElementById('heroOrderNow')?.addEventListener('click', () => {
    document.getElementById('productsGrid')?.scrollIntoView({ behavior: 'smooth' });
  });

  const dotsContainer = document.getElementById('heroCarouselDots');
  if (dotsContainer) {
    dotsContainer.innerHTML = dynamicBanners.map((_, i) => `
      <button onclick="window.setHeroSlide(${i})" class="w-2 h-2 rounded-full transition-all ${
        i === (heroBannerIndex % dynamicBanners.length) ? 'bg-amber-400 w-5' : 'bg-white/40'
      }" aria-label="Slide ${i+1}"></button>
    `).join('');
  }
}

export function startHeroCarousel() {
  setInterval(() => {
    heroBannerIndex = (heroBannerIndex + 1) % dynamicBanners.length;
    renderHeroBanner();
  }, 4500);
}

window.setHeroSlide = function(index) {
  heroBannerIndex = index;
  renderHeroBanner();
};

// -------------------------------------------------------------------
// 5. CATEGORIES & MENU CARDS
// -------------------------------------------------------------------
export function renderCategories() {
  const container = document.getElementById('categoryContainer');
  if (!container) return;

  container.innerHTML = CATEGORIES.map(cat => {
    const isActive = currentCategory === cat.id;
    return `
      <div 
        onclick="window.filterByCategory('${cat.id}')"
        class="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer tap-bounce transition-transform"
      >
        <div class="w-14 h-14 rounded-full flex items-center justify-center transition-all ${
          isActive 
            ? 'bg-gradient-to-tr from-amber-500 to-amber-400 text-gray-950 shadow-md ring-2 ring-amber-500 ring-offset-2' 
            : 'bg-white text-gray-700 border border-gray-200/90 hover:border-amber-400 shadow-sm'
        }">
          <i class="fa-solid ${cat.icon} text-lg"></i>
        </div>
        <span class="text-[11px] font-bold tracking-tight ${
          isActive ? 'text-amber-800' : 'text-gray-600'
        }">${cat.label}</span>
      </div>
    `;
  }).join('');
}

export function renderFeatured() {
  const container = document.getElementById('featuredRow');
  if (!container) return;

  const featuredItems = dynamicMenuItems.filter(item => item.isBestseller).slice(0, 6);
  container.innerHTML = featuredItems.map(item => `
    <div class="min-w-[190px] bg-white rounded-2xl p-2.5 shadow-card border border-amber-100 flex-shrink-0 flex flex-col justify-between relative">
      <div class="relative w-full h-24 rounded-xl overflow-hidden mb-2 bg-amber-50">
        <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover">
        <span class="absolute top-1.5 left-1.5 veg-symbol">
          <span class="dot"></span>
        </span>
        <span class="absolute top-1.5 right-1.5 bg-gray-900/80 backdrop-blur-xs text-amber-400 text-[9px] font-black px-1.5 py-0.5 rounded">
          ★ ${item.rating || 4.8}
        </span>
      </div>
      <div>
        <h4 class="text-xs font-black text-gray-900 truncate leading-snug">${item.name}</h4>
        <p class="text-[10px] text-gray-500 line-clamp-1 mt-0.5">${item.desc || ''}</p>
      </div>
      <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <span class="text-xs font-black text-gray-900">₹${item.price}</span>
        <button 
          onclick="window.addToCart('${item.id}')"
          class="w-7 h-7 rounded-full bg-amber-500 hover:bg-amber-600 text-gray-950 font-black flex items-center justify-center tap-bounce shadow-sm"
          title="Add to Basket"
        >
          <i class="fa-solid fa-plus text-xs"></i>
        </button>
      </div>
    </div>
  `).join('');
}

export function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const emptyState = document.getElementById('emptySearchState');
  const countDisplay = document.getElementById('itemCountDisplay');
  if (!grid) return;

  let filtered = dynamicMenuItems.filter(item => {
    const matchesCategory = currentCategory === 'all' || item.category === currentCategory;
    const matchesSearch = !searchQuery || 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.desc && item.desc.toLowerCase().includes(searchQuery.toLowerCase())) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  if (currentSort === 'bestseller') filtered = filtered.filter(item => item.isBestseller);
  else if (currentSort === 'low-price') filtered = filtered.filter(item => item.price <= 150);
  else if (currentSort === 'top-rated') filtered = filtered.filter(item => (item.rating || 4.8) >= 4.8);

  if (countDisplay) countDisplay.textContent = `${filtered.length} items`;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState?.classList.remove('hidden');
    return;
  }

  emptyState?.classList.add('hidden');

  grid.innerHTML = filtered.map(item => {
    const inCartCount = cart[item.id] || 0;
    const isFav = favorites.includes(item.id);

    return `
      <div class="bg-white rounded-2xl p-2.5 shadow-card border border-gray-100 flex flex-col justify-between relative group hover:border-amber-300 transition-all">
        
        <div class="relative w-full h-28 rounded-xl overflow-hidden bg-amber-50 mb-2">
          <img 
            src="${item.image}" 
            alt="${item.name}" 
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          
          <div class="absolute top-2 left-2 shadow-sm">
            <span class="veg-symbol" title="100% Pure Vegetarian">
              <span class="dot"></span>
            </span>
          </div>

          <button 
            onclick="window.toggleFavorite('${item.id}', event)" 
            class="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur-xs flex items-center justify-center text-gray-400 hover:text-rose-500 tap-bounce shadow-sm transition-colors"
            aria-label="Add to favorites"
          >
            <i class="fa-${isFav ? 'solid text-rose-500' : 'regular'} fa-heart text-xs"></i>
          </button>

          <div class="absolute bottom-2 left-2 bg-gray-900/85 backdrop-blur-xs text-white text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1">
            <i class="fa-solid fa-star text-amber-400 text-[8px]"></i>
            <span>${item.rating || 4.8}</span>
            <span class="text-gray-400 font-normal">(${item.reviews || 120})</span>
          </div>
        </div>

        <div class="flex-1 flex flex-col justify-between">
          <div>
            <h4 class="text-xs font-black text-gray-900 leading-snug line-clamp-1" title="${item.name}">${item.name}</h4>
            <p class="text-[10px] text-gray-500 line-clamp-2 mt-0.5 leading-tight">${item.desc || ''}</p>
          </div>

          <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
            <div>
              <span class="text-[10px] text-gray-400 font-bold block leading-none">Price</span>
              <span class="text-sm font-black text-gray-950">₹${item.price}</span>
            </div>

            ${
              inCartCount > 0 
              ? `
                <div class="flex items-center bg-amber-500 rounded-full px-1.5 py-0.5 shadow-sm text-gray-950 font-black text-xs gap-1.5">
                  <button onclick="window.decrementCart('${item.id}')" class="w-5 h-5 flex items-center justify-center tap-bounce text-[10px]">
                    <i class="fa-solid fa-minus"></i>
                  </button>
                  <span class="text-xs">${inCartCount}</span>
                  <button onclick="window.addToCart('${item.id}')" class="w-5 h-5 flex items-center justify-center tap-bounce text-[10px]">
                    <i class="fa-solid fa-plus"></i>
                  </button>
                </div>
              `
              : `
                <button 
                  onclick="window.addToCart('${item.id}')"
                  class="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-gray-950 font-black flex items-center justify-center shadow-md shadow-amber-500/30 tap-bounce transition-all"
                  title="Add to cart"
                >
                  <i class="fa-solid fa-plus text-xs"></i>
                </button>
              `
            }
          </div>
        </div>

      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------------
// 6. CART & MINIMUM ORDER ENFORCEMENT
// -------------------------------------------------------------------
window.addToCart = function(itemId) {
  cart[itemId] = (cart[itemId] || 0) + 1;
  localStorage.setItem('thz_cart', JSON.stringify(cart));
  const item = dynamicMenuItems.find(i => i.id === itemId);
  showToast(`Added ${item ? item.name : 'dish'} to basket 🛒`);
  renderProducts();
  updateCartUI();
};

window.decrementCart = function(itemId) {
  if (cart[itemId]) {
    cart[itemId] -= 1;
    if (cart[itemId] <= 0) delete cart[itemId];
  }
  localStorage.setItem('thz_cart', JSON.stringify(cart));
  renderProducts();
  updateCartUI();
};

window.removeItemFromCart = function(itemId) {
  delete cart[itemId];
  localStorage.setItem('thz_cart', JSON.stringify(cart));
  renderProducts();
  updateCartUI();
};

window.selectPaymentMethod = function(method) {
  selectedPayment = method;

  const payOnlineRadio = document.getElementById('payOnline');
  const payCODRadio = document.getElementById('payCOD');
  if (payOnlineRadio) payOnlineRadio.checked = (method === 'online');
  if (payCODRadio) payCODRadio.checked = (method === 'cod');

  const cards = document.querySelectorAll('.payment-method-card');
  if (cards.length >= 2) {
    if (method === 'online') {
      cards[0].className = 'payment-method-card flex items-center justify-between p-3 rounded-xl border-2 border-amber-500 bg-amber-50/40 cursor-pointer transition-all';
      cards[1].className = 'payment-method-card flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:border-amber-300 bg-white cursor-pointer transition-all';
    } else {
      cards[0].className = 'payment-method-card flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:border-amber-300 bg-white cursor-pointer transition-all';
      cards[1].className = 'payment-method-card flex items-center justify-between p-3 rounded-xl border-2 border-amber-500 bg-amber-50/40 cursor-pointer transition-all';
    }
  }

  updateCartUI();
};

export function updateCartUI() {
  const itemIds = Object.keys(cart);
  const totalCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const topCartCount = document.getElementById('topCartCount');
  const centerCartBadge = document.getElementById('centerCartBadge');
  if (topCartCount) topCartCount.textContent = totalCount;
  if (centerCartBadge) centerCartBadge.textContent = totalCount;

  let subtotal = 0;
  itemIds.forEach(id => {
    const item = dynamicMenuItems.find(m => m.id === id);
    if (item) subtotal += item.price * cart[id];
  });

  const floatingBar = document.getElementById('floatingCartBar');
  const floatingCount = document.getElementById('floatingItemCount');
  const floatingSummary = document.getElementById('floatingCartSummary');
  const floatingMinNotice = document.getElementById('floatingMinOrderNotice');

  if (totalCount > 0) {
    floatingBar?.classList.remove('hidden');
    if (floatingCount) floatingCount.textContent = totalCount;
    if (floatingSummary) floatingSummary.textContent = `₹${subtotal} • ${totalCount} item${totalCount > 1 ? 's' : ''}`;
    if (floatingMinNotice) {
      if (subtotal < MIN_ORDER_VALUE) {
        floatingMinNotice.textContent = `Add ₹${MIN_ORDER_VALUE - subtotal} more for min order`;
        floatingMinNotice.className = 'text-[10px] text-amber-300 font-bold';
      } else {
        floatingMinNotice.textContent = `Ready to order (Min ₹399 reached)`;
        floatingMinNotice.className = 'text-[10px] text-emerald-400 font-bold';
      }
    }
  } else {
    floatingBar?.classList.add('hidden');
  }

  const cartItemsContainer = document.getElementById('cartItemsList');
  const emptyView = document.getElementById('cartEmptyView');
  const minBanner = document.getElementById('minOrderWarningBanner');
  const minMessage = document.getElementById('minOrderMessage');
  const minProgressBar = document.getElementById('minOrderProgressBar');
  const minIcon = document.getElementById('minOrderIcon');
  const paySection = document.getElementById('cartPaymentSection');
  const couponSec = document.getElementById('cartCouponSection');
  const custSec = document.getElementById('cartCustomerSection');
  const billSec = document.getElementById('cartBillSection');
  const placeOrderBtn = document.getElementById('btnPlaceOrder');
  const placeOrderText = document.getElementById('placeOrderBtnText');
  const headerSubtitle = document.getElementById('cartHeaderSubtitle');

  if (headerSubtitle) headerSubtitle.textContent = `${totalCount} item${totalCount !== 1 ? 's' : ''} in basket`;

  if (totalCount === 0) {
    emptyView?.classList.remove('hidden');
    if (cartItemsContainer) cartItemsContainer.innerHTML = '';
    minBanner?.classList.add('hidden');
    paySection?.classList.add('hidden');
    couponSec?.classList.add('hidden');
    custSec?.classList.add('hidden');
    billSec?.classList.add('hidden');
    if (placeOrderBtn) placeOrderBtn.disabled = true;
    if (placeOrderText) placeOrderText.textContent = 'Your Basket is Empty';
    return;
  }

  emptyView?.classList.add('hidden');
  minBanner?.classList.remove('hidden');
  paySection?.classList.remove('hidden');
  couponSec?.classList.remove('hidden');
  custSec?.classList.remove('hidden');
  billSec?.classList.remove('hidden');

  if (cartItemsContainer) {
    cartItemsContainer.innerHTML = itemIds.map(id => {
      const item = dynamicMenuItems.find(m => m.id === id);
      if (!item) return '';
      const qty = cart[id];
      return `
        <div class="flex items-center justify-between p-2.5 bg-gray-50 rounded-2xl border border-gray-200/80">
          <div class="flex items-center gap-2.5 max-w-[55%]">
            <img src="${item.image}" alt="${item.name}" class="w-12 h-12 rounded-xl object-cover">
            <div>
              <div class="flex items-center gap-1">
                <span class="veg-symbol"><span class="dot"></span></span>
                <h5 class="text-xs font-black text-gray-900 truncate">${item.name}</h5>
              </div>
              <div class="text-xs font-bold text-gray-900 mt-0.5">₹${item.price}</div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex items-center bg-white border border-gray-300 rounded-full px-2 py-1 shadow-sm gap-2">
              <button onclick="window.decrementCart('${item.id}')" class="text-gray-600 hover:text-amber-600 text-xs tap-bounce">
                <i class="fa-solid fa-minus"></i>
              </button>
              <span class="text-xs font-black text-gray-900">${qty}</span>
              <button onclick="window.addToCart('${item.id}')" class="text-gray-600 hover:text-amber-600 text-xs tap-bounce">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
            <button onclick="window.removeItemFromCart('${item.id}')" class="text-gray-400 hover:text-rose-500 text-xs p-1" title="Remove">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  const isMinMet = subtotal >= MIN_ORDER_VALUE;
  const remainingAmount = MIN_ORDER_VALUE - subtotal;
  const progressPercent = Math.min(100, Math.round((subtotal / MIN_ORDER_VALUE) * 100));

  if (minProgressBar) minProgressBar.style.width = `${progressPercent}%`;

  if (!isMinMet) {
    if (minBanner) minBanner.className = 'p-3 rounded-2xl border border-amber-300 bg-amber-50/80 transition-all';
    if (minIcon) minIcon.className = 'fa-solid fa-triangle-exclamation text-amber-600 mt-0.5 text-sm';
    if (minProgressBar) minProgressBar.className = 'bg-amber-500 h-full rounded-full transition-all duration-300';
    if (minMessage) minMessage.innerHTML = `Add items worth <span class="text-amber-700 font-black">₹${remainingAmount}</span> more to reach ₹399 min order`;
  } else {
    if (minBanner) minBanner.className = 'p-3 rounded-2xl border border-emerald-300 bg-emerald-50/80 transition-all';
    if (minIcon) minIcon.className = 'fa-solid fa-circle-check text-emerald-600 mt-0.5 text-sm';
    if (minProgressBar) minProgressBar.className = 'bg-emerald-600 h-full rounded-full transition-all duration-300';
    if (minMessage) minMessage.innerHTML = `<span class="text-emerald-800 font-black">🎉 Minimum order ₹399 reached! Ready to order.</span>`;
  }

  const deliveryCharge = (selectedPayment === 'online') ? 0 : 40;

  let discount = 0;
  if (appliedCoupon === 'VEG40') discount = 40;
  if (appliedCoupon === 'HUNGER50') discount = 50;

  const grandTotal = Math.max(0, subtotal + deliveryCharge - discount);

  document.getElementById('billSubtotal').textContent = `₹${subtotal}`;
  const billDeliveryLabel = document.getElementById('billDeliveryLabel');
  const billDelivery = document.getElementById('billDelivery');

  if (selectedPayment === 'online') {
    if (billDeliveryLabel) billDeliveryLabel.textContent = 'Delivery Charge (Pay Online UPI)';
    if (billDelivery) {
      billDelivery.textContent = 'FREE (₹0)';
      billDelivery.className = 'font-bold text-emerald-600';
    }
  } else {
    if (billDeliveryLabel) billDeliveryLabel.textContent = 'Delivery Charge (Cash on Delivery)';
    if (billDelivery) {
      billDelivery.textContent = '₹40';
      billDelivery.className = 'font-bold text-amber-700';
    }
  }

  const discountRow = document.getElementById('billDiscountRow');
  if (discount > 0) {
    discountRow?.classList.remove('hidden');
    document.getElementById('billDiscount').textContent = `-₹${discount}`;
  } else {
    discountRow?.classList.add('hidden');
  }

  document.getElementById('billGrandTotal').textContent = `₹${grandTotal}`;

  if (!isMinMet) {
    if (placeOrderBtn) placeOrderBtn.disabled = true;
    if (placeOrderText) placeOrderText.textContent = `Add ₹${remainingAmount} more to reach ₹399 min order`;
  } else {
    if (placeOrderBtn) placeOrderBtn.disabled = false;
    if (placeOrderText) {
      placeOrderText.textContent = selectedPayment === 'online' 
        ? `Proceed to Pay via UPI • ₹${grandTotal}` 
        : `Place Cash Order • ₹${grandTotal}`;
    }
  }
}

// -------------------------------------------------------------------
// 7. UPI GATEWAY & CHECKOUT FLOW
// -------------------------------------------------------------------
export function initiateCheckoutWorkflow() {
  const itemIds = Object.keys(cart);
  let subtotal = 0;
  itemIds.forEach(id => {
    const item = dynamicMenuItems.find(m => m.id === id);
    if (item) subtotal += item.price * cart[id];
  });

  if (subtotal < MIN_ORDER_VALUE) {
    showToast(`Minimum order value is ₹399. Please add ₹${MIN_ORDER_VALUE - subtotal} more.`);
    return;
  }

  const name = document.getElementById('custName')?.value.trim();
  const phone = document.getElementById('custPhone')?.value.trim();
  const address = document.getElementById('custAddress')?.value.trim();

  if (!name) {
    showToast('Please enter your full name');
    document.getElementById('custName')?.focus();
    return;
  }
  if (!phone || phone.length < 10) {
    showToast('Please enter a valid 10-digit mobile number');
    document.getElementById('custPhone')?.focus();
    return;
  }
  if (!address) {
    showToast('Please enter your delivery address');
    document.getElementById('custAddress')?.focus();
    return;
  }

  localStorage.setItem('thz_user_name', name);
  localStorage.setItem('thz_user_phone', phone);
  updateProfileDisplay();

  const deliveryCharge = (selectedPayment === 'online') ? 0 : 40;
  let discount = 0;
  if (appliedCoupon === 'VEG40') discount = 40;
  if (appliedCoupon === 'HUNGER50') discount = 50;
  const grandTotal = Math.max(0, subtotal + deliveryCharge - discount);
  const orderId = 'THZ-' + Math.floor(1000 + Math.random() * 9000);

  const itemsSnapshot = itemIds.map(id => {
    const it = dynamicMenuItems.find(m => m.id === id);
    return {
      id: id,
      name: it ? it.name : id,
      price: it ? it.price : 0,
      quantity: cart[id]
    };
  });

  pendingOrderRecord = {
    orderId: orderId,
    restaurant: "The Hunger Zone (Pure Veg)",
    customerEmail: currentUser ? currentUser.email : 'guest@hungerzone.in',
    customer: { 
      name, 
      phone, 
      address,
      email: currentUser ? currentUser.email : 'guest@hungerzone.in' 
    },
    items: itemsSnapshot,
    subtotal: subtotal,
    deliveryFee: deliveryCharge,
    paymentMethod: selectedPayment === 'online' ? 'Pay Online (UPI / QR)' : 'Cash on Delivery (COD)',
    appliedCoupon: appliedCoupon || 'NONE',
    grandTotal: `₹${grandTotal}`,
    currentStep: 1, // 1: Order Placed, 2: In Kitchen / Cooking, 3: Out for Delivery, 4: Delivered
    status: 'Order Placed',
    timestamp: new Date().toISOString(),
    createdTimeMs: Date.now(),
    formattedDate: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) + ', Today'
  };

  if (selectedPayment === 'online') {
    closeCart();
    openUPIGatewayModal(grandTotal, orderId);
  } else {
    finalizeOrderSuccess();
  }
}

function openUPIGatewayModal(amount, orderId) {
  const modal = document.getElementById('upiGatewayModal');
  if (!modal) return;

  document.getElementById('upiModalAmount').textContent = `₹${amount}`;
  document.getElementById('upiModalOrderId').textContent = `#${orderId}`;

  upiSecondsRemaining = 300;
  clearInterval(upiTimerInterval);
  updateUPITimerDisplay();

  upiTimerInterval = setInterval(() => {
    upiSecondsRemaining--;
    updateUPITimerDisplay();
    if (upiSecondsRemaining <= 0) {
      clearInterval(upiTimerInterval);
      showToast('UPI payment session timed out. Please try again.');
      closeUPIGatewayModal();
    }
  }, 1000);

  modal.classList.remove('hidden');
}

function updateUPITimerDisplay() {
  const minutes = Math.floor(upiSecondsRemaining / 60);
  const seconds = upiSecondsRemaining % 60;
  const display = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  const timerElem = document.getElementById('upiTimerDisplay');
  if (timerElem) timerElem.textContent = display;
}

export function closeUPIGatewayModal() {
  clearInterval(upiTimerInterval);
  document.getElementById('upiGatewayModal')?.classList.add('hidden');
}
window.closeUPIGatewayModal = closeUPIGatewayModal;

window.simulateUPIAppPayment = function(appName) {
  showToast(`Redirecting to ${appName}... Authorize payment on your UPI app.`);
  const btn = document.getElementById('btnSimulateVerifyUPI');
  if (btn) {
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Verifying with ${appName}...`;
    setTimeout(() => {
      btn.innerHTML = `<i class="fa-solid fa-shield-check mr-1"></i> Verify & Confirm Payment`;
    }, 1500);
  }
};

window.confirmAndVerifyUPIPayment = function() {
  const btn = document.getElementById('btnSimulateVerifyUPI');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Confirming with Bank NPCI...`;
  }

  setTimeout(() => {
    closeUPIGatewayModal();
    finalizeOrderSuccess();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-shield-check mr-1"></i> Verify & Confirm Payment`;
    }
  }, 1200);
};

async function finalizeOrderSuccess() {
  if (!pendingOrderRecord) return;

  playSuccessChime();
  fireConfetti();

  const orders = JSON.parse(localStorage.getItem('thz_orders') || '[]');
  orders.unshift(pendingOrderRecord);
  localStorage.setItem('thz_orders', JSON.stringify(orders));

  if (db) {
    db.collection('orders').add(pendingOrderRecord).catch(err => {
      console.log("Firestore local persistence maintained:", err.message);
    });
  }

  cart = {};
  localStorage.setItem('thz_cart', JSON.stringify(cart));
  renderProducts();
  updateCartUI();
  closeCart();

  document.getElementById('confirmedOrderId').textContent = `#${pendingOrderRecord.orderId}`;
  document.getElementById('confirmedOrderPayment').textContent = pendingOrderRecord.paymentMethod;
  document.getElementById('confirmedOrderTotal').textContent = pendingOrderRecord.grandTotal;
  document.getElementById('orderSuccessModal')?.classList.remove('hidden');

  // Trigger live tracker simulation for this order
  startLiveOrderProgression();
}

// -------------------------------------------------------------------
// 8. REAL-TIME 4-STEP LIVE ORDER STATUS TRACKER
// -------------------------------------------------------------------
function startLiveOrderProgression() {
  if (liveOrderTrackerInterval) clearInterval(liveOrderTrackerInterval);

  liveOrderTrackerInterval = setInterval(() => {
    const orders = JSON.parse(localStorage.getItem('thz_orders') || '[]');
    let modified = false;

    orders.forEach(order => {
      const ageMs = Date.now() - (order.createdTimeMs || Date.now());
      let newStep = order.currentStep || 1;

      if (ageMs > 90000) newStep = 4; // Delivered after 1.5 mins
      else if (ageMs > 45000) newStep = 3; // Out for delivery
      else if (ageMs > 15000) newStep = 2; // In Kitchen / Cooking

      if (newStep !== order.currentStep) {
        order.currentStep = newStep;
        if (newStep === 2) order.status = 'In Kitchen / Cooking 👨🍳';
        if (newStep === 3) order.status = 'Out for Delivery 🛵';
        if (newStep === 4) order.status = 'Delivered ✅';
        modified = true;
      }
    });

    if (modified) {
      localStorage.setItem('thz_orders', JSON.stringify(orders));
      if (currentTab === 'orders') refreshOrdersList();
    }
  }, 10000);
}

window.simulateAdvanceOrderStage = function(orderId) {
  const orders = JSON.parse(localStorage.getItem('thz_orders') || '[]');
  const order = orders.find(o => o.orderId === orderId);
  if (!order) return;

  order.currentStep = (order.currentStep || 1) + 1;
  if (order.currentStep > 4) order.currentStep = 4;

  const stepLabels = {
    1: 'Order Placed',
    2: 'In Kitchen / Cooking 👨🍳',
    3: 'Out for Delivery 🛵',
    4: 'Delivered ✅'
  };
  order.status = stepLabels[order.currentStep];

  localStorage.setItem('thz_orders', JSON.stringify(orders));
  playSuccessChime();
  showToast(`Order status updated: ${order.status}`);
  refreshOrdersList();
};

export function refreshOrdersList() {
  const container = document.getElementById('ordersListContainer');
  if (!container) return;

  const orders = JSON.parse(localStorage.getItem('thz_orders') || '[]');

  // Filter strictly by the currently logged-in user's email: where('customerEmail', '==', currentUser.email)
  let userOrders = [];
  if (currentUser && currentUser.email) {
    userOrders = orders.filter(o => 
      o.customerEmail === currentUser.email || 
      (o.customer && o.customer.email === currentUser.email)
    );
  } else {
    // For guest users, display orders placed as guest
    userOrders = orders.filter(o => 
      !o.customerEmail || 
      o.customerEmail === 'guest@hungerzone.in' || 
      (o.customer && o.customer.email === 'guest@hungerzone.in')
    );
  }

  // If the orders list is empty, display a clean empty-state UI saying 'No past orders yet! Place your first delicious order 🍔' with an 'Explore Menu' button.
  if (userOrders.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs">
        <div class="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-3">
          🍔
        </div>
        <h4 class="text-sm font-black text-gray-900">No past orders yet! Place your first delicious order 🍔</h4>
        <p class="text-xs text-gray-500 max-w-[240px] mx-auto mt-1.5">
          ${currentUser ? `No orders found for ${currentUser.email}. Discover pure vegetarian delights!` : 'Sign in with Google to sync your orders or start adding dishes to your basket!'}
        </p>
        <button onclick="window.switchTab('home')" class="mt-4 bg-amber-500 hover:bg-amber-600 text-gray-950 font-black text-xs px-6 py-2.5 rounded-full shadow-md tap-bounce transition-all">
          Explore Menu
        </button>
      </div>
    `;
    return;
  }

  // If orders exist, display only that user's specific order cards
  container.innerHTML = userOrders.map(order => {
    const step = order.currentStep || 1;
    const isCompleted = step === 4;

    return `
      <div class="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm space-y-3.5">
        <div class="flex items-center justify-between border-b pb-2.5">
          <div>
            <span class="text-xs font-black text-gray-900">${order.orderId}</span>
            <div class="text-[10px] text-gray-500">${order.formattedDate || 'Recent'}</div>
          </div>
          <span class="text-[10px] font-black ${
            isCompleted 
              ? 'bg-emerald-100 text-emerald-800' 
              : 'bg-amber-100 text-amber-800'
          } px-2.5 py-0.5 rounded-full flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}"></span>
            ${order.status || 'Order Placed'}
          </span>
        </div>

        <!-- Real-Time 4-Step Dynamic Progress Bar -->
        <div class="bg-cream rounded-2xl p-3 border border-amber-200/70 space-y-2">
          <div class="flex items-center justify-between text-[9px] font-black text-gray-500">
            <span>Live Kitchen Tracker</span>
            <span class="text-amber-800 font-bold">Step ${step} of 4</span>
          </div>

          <div class="relative flex items-center justify-between">
            <!-- Connecting progress background line -->
            <div class="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-1 bg-gray-200 -z-0 rounded-full"></div>
            <!-- Active progress filled line -->
            <div class="absolute left-3 top-1/2 -translate-y-1/2 h-1 bg-emerald-500 -z-0 rounded-full transition-all duration-500" style="width: ${((step - 1) / 3) * 88}%"></div>

            <!-- Step 1: Placed -->
            <div class="flex flex-col items-center z-10">
              <span class="w-6 h-6 rounded-full ${step >= 1 ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-200 text-gray-400'} flex items-center justify-center text-[10px] font-bold">
                <i class="fa-solid fa-check"></i>
              </span>
              <span class="text-[9px] mt-1 font-bold ${step >= 1 ? 'text-gray-900' : 'text-gray-400'}">Placed</span>
            </div>

            <!-- Step 2: Cooking -->
            <div class="flex flex-col items-center z-10">
              <span class="w-6 h-6 rounded-full ${
                step > 2 ? 'bg-emerald-500 text-white' : (step === 2 ? 'bg-amber-500 text-gray-950 font-black ring-2 ring-amber-400 shadow-md animate-pulse' : 'bg-gray-200 text-gray-400')
              } flex items-center justify-center text-[10px]">
                <i class="fa-solid fa-fire"></i>
              </span>
              <span class="text-[9px] mt-1 font-bold ${step >= 2 ? 'text-gray-900' : 'text-gray-400'}">Cooking 👨🍳</span>
            </div>

            <!-- Step 3: Out for Delivery -->
            <div class="flex flex-col items-center z-10">
              <span class="w-6 h-6 rounded-full ${
                step > 3 ? 'bg-emerald-500 text-white' : (step === 3 ? 'bg-amber-500 text-gray-950 font-black ring-2 ring-amber-400 shadow-md animate-pulse' : 'bg-gray-200 text-gray-400')
              } flex items-center justify-center text-[10px]">
                <i class="fa-solid fa-motorcycle"></i>
              </span>
              <span class="text-[9px] mt-1 font-bold ${step >= 3 ? 'text-gray-900' : 'text-gray-400'}">On Way 🛵</span>
            </div>

            <!-- Step 4: Delivered -->
            <div class="flex flex-col items-center z-10">
              <span class="w-6 h-6 rounded-full ${
                step === 4 ? 'bg-emerald-500 text-white shadow-md' : 'bg-gray-200 text-gray-400'
              } flex items-center justify-center text-[10px]">
                <i class="fa-solid fa-house-chimney"></i>
              </span>
              <span class="text-[9px] mt-1 font-bold ${step === 4 ? 'text-emerald-700' : 'text-gray-400'}">Delivered ✅</span>
            </div>
          </div>

          ${
            !isCompleted 
            ? `
              <div class="pt-1.5 flex justify-end">
                <button onclick="window.simulateAdvanceOrderStage('${order.orderId}')" class="text-[10px] font-black text-amber-700 hover:text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded-full flex items-center gap-1 tap-bounce">
                  <span>Simulate Next Stage</span>
                  <i class="fa-solid fa-forward-step text-[9px]"></i>
                </button>
              </div>
            `
            : ''
          }
        </div>

        <!-- Items in order -->
        <div class="space-y-1 text-xs">
          ${(order.items || []).map(it => `
            <div class="flex justify-between text-gray-700">
              <span class="flex items-center gap-1.5">
                <span class="veg-symbol"><span class="dot"></span></span>
                <span class="font-medium">${it.name} <span class="font-bold text-gray-900">x${it.quantity}</span></span>
              </span>
              <span class="font-bold text-gray-900">₹${it.price * it.quantity}</span>
            </div>
          `).join('')}
        </div>

        <div class="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
          <div>
            <span class="text-[10px] text-gray-500 block leading-tight">Payment Mode</span>
            <span class="font-bold text-gray-800 text-[11px]">${order.paymentMethod}</span>
          </div>
          <div class="text-right">
            <span class="text-[10px] text-gray-500 block leading-tight">Total Paid</span>
            <span class="font-black text-amber-600 text-sm">${order.grandTotal}</span>
          </div>
        </div>

        <button onclick="window.reorderItems('${order.orderId}')" class="w-full bg-cream hover:bg-amber-50 border border-amber-200 text-amber-800 font-bold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 tap-bounce">
          <i class="fa-solid fa-arrow-rotate-right text-[11px]"></i>
          <span>Order Again</span>
        </button>
      </div>
    `;
  }).join('');
}

window.reorderItems = function(orderId) {
  const orders = JSON.parse(localStorage.getItem('thz_orders') || '[]');
  const order = orders.find(o => o.orderId === orderId);
  if (!order || !order.items) return;

  order.items.forEach(it => {
    cart[it.id] = (cart[it.id] || 0) + it.quantity;
  });
  localStorage.setItem('thz_cart', JSON.stringify(cart));
  renderProducts();
  updateCartUI();
  openCart();
  showToast('Dishes reloaded into your basket 🛒');
};

// -------------------------------------------------------------------
// 9. PROFILE & TAB NAVIGATION
// -------------------------------------------------------------------
export function switchTab(tabName) {
  currentTab = tabName;

  document.querySelectorAll('.nav-tab').forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (target === tabName) {
      btn.classList.add('active', 'text-amber-500');
      btn.classList.remove('text-gray-500');
    } else {
      btn.classList.remove('active', 'text-amber-500');
      btn.classList.add('text-gray-500');
    }
  });

  const homeView = document.getElementById('homeView');
  const ordersView = document.getElementById('ordersView');
  const profileView = document.getElementById('profileView');

  if (tabName === 'home') {
    homeView?.classList.remove('hidden');
    ordersView?.classList.add('hidden');
    profileView?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (tabName === 'menu') {
    homeView?.classList.remove('hidden');
    ordersView?.classList.add('hidden');
    profileView?.classList.add('hidden');
    document.getElementById('productsGrid')?.scrollIntoView({ behavior: 'smooth' });
  } else if (tabName === 'orders') {
    homeView?.classList.add('hidden');
    ordersView?.classList.remove('hidden');
    profileView?.classList.add('hidden');
    refreshOrdersList();
  } else if (tabName === 'offers') {
    openOffersModal();
  } else if (tabName === 'profile') {
    homeView?.classList.add('hidden');
    ordersView?.classList.add('hidden');
    profileView?.classList.remove('hidden');
    updateProfileDisplay();
  }
}
window.switchTab = switchTab;

export function updateProfileDisplay() {
  updateAuthUI();

  const favCount = favorites.length;
  const favBadge = document.getElementById('profileFavCount');
  if (favBadge) favBadge.textContent = `${favCount} items`;

  const custNameInput = document.getElementById('custName');
  const custPhoneInput = document.getElementById('custPhone');
  if (custNameInput && !custNameInput.value && currentUser) custNameInput.value = currentUser.name;
  if (custPhoneInput && !custPhoneInput.value) {
    const savedPhone = localStorage.getItem('thz_user_phone');
    if (savedPhone) custPhoneInput.value = savedPhone;
  }
}

// -------------------------------------------------------------------
// 10. MODALS & HELPERS
// -------------------------------------------------------------------
export function openCart() {
  updateCartUI();
  document.getElementById('cartModal')?.classList.remove('hidden');
}
window.openCart = openCart;

export function closeCart() {
  document.getElementById('cartModal')?.classList.add('hidden');
}
window.closeCart = closeCart;

export function openOffersModal() {
  document.getElementById('offersModal')?.classList.remove('hidden');
}
window.openOffersModal = openOffersModal;

export function closeOffersModal() {
  document.getElementById('offersModal')?.classList.add('hidden');
}
window.closeOffersModal = closeOffersModal;

export function openNotificationsModal() {
  document.getElementById('notificationsModal')?.classList.remove('hidden');
  document.getElementById('notifBadge')?.classList.add('hidden');
}
window.openNotificationsModal = openNotificationsModal;

export function closeNotificationsModal() {
  document.getElementById('notificationsModal')?.classList.add('hidden');
}
window.closeNotificationsModal = closeNotificationsModal;

export function closeOrderSuccessModal() {
  document.getElementById('orderSuccessModal')?.classList.add('hidden');
}
window.closeOrderSuccessModal = closeOrderSuccessModal;

window.viewMyOrdersAfterSuccess = function() {
  closeOrderSuccessModal();
  switchTab('orders');
};

window.filterByCategory = function(catId) {
  currentCategory = catId;
  renderCategories();
  renderProducts();
  const catObj = CATEGORIES.find(c => c.id === catId);
  const titleElem = document.getElementById('menuSectionTitle');
  if (titleElem) titleElem.textContent = catObj ? `${catObj.label} Delights` : 'Complete Menu';
};

window.toggleFavorite = function(itemId, event) {
  if (event) event.stopPropagation();
  if (favorites.includes(itemId)) {
    favorites = favorites.filter(id => id !== itemId);
    showToast('Removed from favorites');
  } else {
    favorites.push(itemId);
    showToast('Saved to favorites ❤️');
  }
  localStorage.setItem('thz_favs', JSON.stringify(favorites));
  renderProducts();
  updateProfileDisplay();
};

window.quickApplyCoupon = function(code) {
  const couponInput = document.getElementById('couponInput');
  if (couponInput) couponInput.value = code;
  applyCoupon(code);
};

export function applyCoupon(code) {
  code = (code || '').trim().toUpperCase();
  if (code === 'VEG40' || code === 'HUNGER50') {
    appliedCoupon = code;
    const statusText = document.getElementById('couponStatusText');
    if (statusText) {
      statusText.textContent = `Applied: ${code} ✅`;
      statusText.className = 'text-[10px] text-emerald-600 font-bold';
    }
    showToast(`Coupon ${code} applied successfully! 🎉`);
  } else {
    showToast('Invalid promo code');
  }
  updateCartUI();
}

window.applyFromOffers = function(code) {
  closeOffersModal();
  openCart();
  window.quickApplyCoupon(code);
};

export function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'bg-gray-900/95 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl flex items-center justify-between gap-2 border border-amber-500/40 animate-slide-up backdrop-blur-md pointer-events-auto';
  toast.innerHTML = `
    <span class="flex items-center gap-1.5">
      <i class="fa-solid fa-circle-check text-amber-400"></i> ${message}
    </span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// -------------------------------------------------------------------
// 11. BOOTSTRAP INITIALIZATION
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  renderHeroBanner();
  startHeroCarousel();
  renderCategories();
  renderFeatured();
  renderProducts();
  updateCartUI();
  updateProfileDisplay();
  startLiveOrderProgression();

  // Top Buttons
  document.getElementById('btnTopCart')?.addEventListener('click', openCart);
  document.getElementById('btnFloatingViewCart')?.addEventListener('click', openCart);
  document.getElementById('btnCloseCart')?.addEventListener('click', closeCart);
  document.getElementById('btnOpenNotifications')?.addEventListener('click', openNotificationsModal);
  document.getElementById('btnPlaceOrder')?.addEventListener('click', initiateCheckoutWorkflow);

  // Bottom Center Order Button
  document.getElementById('btnCenterOrder')?.addEventListener('click', () => {
    if (Object.keys(cart).length > 0) openCart();
    else switchTab('orders');
  });

  // Coupon apply
  document.getElementById('btnApplyCoupon')?.addEventListener('click', () => {
    const val = document.getElementById('couponInput')?.value;
    applyCoupon(val);
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearch');
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    clearSearchBtn?.classList.toggle('hidden', !searchQuery);
    renderProducts();
  });
  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchQuery = '';
    clearSearchBtn?.classList.add('hidden');
    renderProducts();
  });

  // Filter Chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.remove('bg-amber-500', 'text-gray-950');
        c.classList.add('bg-white', 'text-gray-700');
      });
      chip.classList.remove('bg-white', 'text-gray-700');
      chip.classList.add('bg-amber-500', 'text-gray-950');

      currentSort = chip.getAttribute('data-filter');
      renderProducts();
    });
  });

  // Navigation Bar Tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-target');
      switchTab(target);
    });
  });

  // Filter toggle
  document.getElementById('btnFilterToggle')?.addEventListener('click', () => {
    const nextFilter = currentSort === 'all' ? 'bestseller' : (currentSort === 'bestseller' ? 'low-price' : 'all');
    const chip = document.querySelector(`.filter-chip[data-filter="${nextFilter}"]`);
    if (chip) chip.click();
    showToast(`Filter: ${nextFilter}`);
  });
});
