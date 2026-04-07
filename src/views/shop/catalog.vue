<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useCartStore } from '@/stores/cart.js'; // <-- Import Cart Store
import { request } from '@/utils/http.js';
import { baseUrl } from '@/utils/variables.js';

const router = useRouter();
const userStore = useUserStore();
const cartStore = useCartStore(); // <-- Instantiate Cart Store

// --- State ---
const products = ref([]);
const error = ref('');

const searchQuery = ref('');
const sortBy = ref('name_asc');
const selectedCategory = ref('All');

// Details Modal State
const selectedProduct = ref(null);

// Gallery Modal State
const selectedGalleryProduct = ref(null);
const galleryScrollContainer = ref(null);
const currentGalleryIndex = ref(0);

// --- Fetch Data ---
const fetchProducts = async () => {
  cartStore.loading = true;
  error.value = '';
  
  try {
    const response = await request.send({
      url: `${baseUrl}/products/all`,
      method: 'POST',
      data: { country_code: userStore.countryCode || 'US' },
      token: userStore.idToken
    });

    if (response.status === 'success' && Array.isArray(response.message)) {
      products.value = response.message;
    } else {
      throw new Error('Invalid response format');
    }
  } catch (err) {
    console.error('Failed to fetch products:', err);
    error.value = 'Failed to load products. Please try again.';
  } finally {
    cartStore.loading = false;
  }
};

// --- Computed ---
const categories = computed(() => {
  const cats = new Set(products.value.map(p => p.category).filter(Boolean));
  return ['All', ...Array.from(cats).sort()];
});

const processedProducts = computed(() => {
  let arr = [...products.value];

  // 1. Filter by Category
  if (selectedCategory.value !== 'All') {
    arr = arr.filter(p => p.category === selectedCategory.value);
  }

  // 2. Filter by Search
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    arr = arr.filter(p => p.name?.toLowerCase().includes(query));
  }

  // 3. Sort
  arr.sort((a, b) => {
    switch (sortBy.value) {
      case 'name_asc': return (a.name || '').localeCompare(b.name || '');
      case 'name_desc': return (b.name || '').localeCompare(a.name || '');
      case 'price_asc': return (a.price_usd || 0) - (b.price_usd || 0);
      case 'price_desc': return (b.price_usd || 0) - (a.price_usd || 0);
      default: return 0;
    }
  });

  return arr;
});

// --- Actions ---
const getImagesArray = (imagesString) => {
  if (!imagesString) return [];
  return imagesString.split(',').map(uuid => `https://api.navitag.net/dump/${uuid.trim()}`);
};

const getFirstImageUrl = (imagesString) => {
  const arr = getImagesArray(imagesString);
  return arr.length > 0 ? arr[0] : null;
};

// Details Modal
const openModal = (product) => {
  selectedProduct.value = product;
};

const closeModal = () => {
  selectedProduct.value = null;
};

// Gallery Modal
const openGalleryModal = (product) => {
  selectedGalleryProduct.value = product;
  currentGalleryIndex.value = 0;
};

const closeGalleryModal = () => {
  selectedGalleryProduct.value = null;
};

// Keeps the index in sync when a user swipes on touch screens
const onGalleryScroll = (e) => {
  const width = e.target.clientWidth;
  const scrollLeft = e.target.scrollLeft;
  currentGalleryIndex.value = Math.round(scrollLeft / width);
};

// Programmatic scrolling for the left/right buttons
const scrollGallery = (direction) => {
  if (!galleryScrollContainer.value) return;
  const width = galleryScrollContainer.value.clientWidth;
  galleryScrollContainer.value.scrollBy({ left: direction * width, behavior: 'smooth' });
};

// --- Lifecycle ---
onMounted(() => {
  fetchProducts();
});
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4 pb-2">        
        <div class="flex space-x-6 overflow-x-auto no-scrollbar mb-4">
          <button 
            class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-brand text-brand"
          >
            <i class="fa-solid fa-box"></i>
            All Products
          </button>
          <button 
            @click="router.replace('data-plans')"
            class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-transparent text-gray-500 hover:text-gray-700"
          >
            <i class="fa-solid fa-wifi"></i>
            Data Plans
          </button>
        </div>

        <div class="relative mb-3">
          <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input 
            v-model="searchQuery"
            type="text" 
            placeholder="Search products..." 
            class="w-full pl-10 pr-4 py-2 bg-gray-100 border-transparent rounded-xl text-sm focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none"
          />
        </div>

        <div class="flex items-center justify-between pb-1 gap-2">
          <div class="shrink-0 flex items-center gap-1.5 flex-1 min-w-0">
            <i class="fa-solid fa-filter text-gray-400 text-xs"></i>
            <select v-model="selectedCategory" class="bg-transparent text-xs font-semibold text-gray-600 outline-none cursor-pointer w-full truncate">
              <option v-for="cat in categories" :key="cat" :value="cat">
                {{ cat }}
              </option>
            </select>
          </div>

          <div class="shrink-0 flex items-center gap-1.5 pl-2 border-l border-gray-200">
            <i class="fa-solid fa-arrow-down-short-wide text-gray-400 text-xs"></i>
            <select v-model="sortBy" class="bg-transparent text-xs font-semibold text-gray-600 outline-none cursor-pointer">
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              <option value="price_asc">Price (Low to High)</option>
              <option value="price_desc">Price (High to Low)</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="p-4 space-y-4 pb-35">

      <div v-if="error" class="text-center text-red-500 py-10 bg-red-50 rounded-xl border border-red-200 shadow-sm">
        <i class="fa-solid fa-triangle-exclamation text-3xl mb-3 text-red-400"></i>
        <p class="text-sm px-4">{{ error }}</p>
        <button @click="fetchProducts" class="mt-4 text-sm font-bold text-red-600 hover:underline">Try Again</button>
      </div>

      <div v-else-if="processedProducts.length === 0" class="text-center text-gray-500 py-10 bg-white rounded-xl border border-gray-200 shadow-sm">
        <i class="fa-solid fa-box-open text-3xl mb-3 text-gray-300"></i>
        <p class="text-sm px-4">No products found matching your criteria.</p>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div 
          v-for="product in processedProducts" 
          :key="product.id"
          class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col"
        >
          <div class="w-full aspect-square bg-gray-100 relative group" @click="openGalleryModal(product)">
            <div 
              v-if="getImagesArray(product.images).length > 0" 
              class="flex overflow-x-auto snap-x snap-mandatory no-scrollbar h-full w-full"
            >
              <div 
                v-for="img in getImagesArray(product.images)" 
                :key="img" 
                class="snap-center shrink-0 w-full h-full relative cursor-pointer"
              >
                <img :src="img" :alt="product.name" class="w-full h-full object-cover" @error="(e) => e.target.style.display='none'" />
              </div>
            </div>
            
            <div v-else class="w-full h-full flex items-center justify-center cursor-pointer">
              <i class="fa-solid fa-image text-4xl text-gray-300"></i>
            </div>
            
            <span v-if="product.category" class="absolute top-2 left-2 bg-white/90 backdrop-blur-sm text-gray-700 text-[10px] font-bold px-2 py-1 rounded shadow-sm pointer-events-none">
              {{ product.category }}
            </span>
            
            <div v-if="getImagesArray(product.images).length > 1" class="absolute bottom-2 right-2 bg-black/40 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 pointer-events-none">
              <i class="fa-solid fa-images"></i> {{ getImagesArray(product.images).length }}
            </div>
          </div>

          <div class="p-4 flex flex-col flex-1">
            <button @click="openModal(product)" class="text-left outline-none cursor-pointer">
              <h2 class="text-base font-bold text-gray-800 leading-tight mb-1 hover:text-brand transition-colors">{{ product.name }}</h2>
            </button>
            <p class="text-lg font-bold text-brand mb-4">${{ product.price_usd }}</p>
            
            <div class="mt-auto flex items-center gap-2">
              <button 
                @click="openModal(product)"
                class="w-10 h-10 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors active:scale-95 outline-none"
              >
                <i class="fa-solid fa-circle-info"></i>
              </button>

              <button 
                v-if="cartStore.getProductQuantity(product.id) === 0"
                @click.stop="cartStore.addProduct(product)"
                class="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-2.5 rounded-lg transition-colors text-sm flex justify-center items-center gap-2 active:scale-95 outline-none"
              >
                <i class="fa-solid fa-cart-plus"></i> Add to Cart
              </button>

              <div v-else class="flex-1 flex items-center justify-between bg-brand-light border border-brand-light rounded-lg p-1 h-10">
                <button 
                  @click.stop="cartStore.removeProduct(product)"
                  class="w-8 h-full flex items-center justify-center bg-white rounded-md text-brand font-bold shadow-sm active:scale-95 outline-none"
                >
                  <i class="fa-solid" :class="cartStore.getProductQuantity(product.id) === 1 ? 'fa-trash-can' : 'fa-minus'"></i>
                </button>
                <span class="font-bold text-brand-dark text-sm w-8 text-center">
                  {{ cartStore.getProductQuantity(product.id) }}
                </span>
                <button 
                  @click.stop="cartStore.addProduct(product)"
                  class="w-8 h-full flex items-center justify-center bg-brand rounded-md text-white font-bold shadow-sm active:scale-95 outline-none"
                >
                  <i class="fa-solid fa-plus"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div 
      v-if="cartStore.productCount > 0"
      class="fixed bottom-[calc(48px+env(safe-area-inset-bottom))] left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)] z-30 transform transition-transform"
    >
      <div class="flex justify-between items-center mb-3 px-1">
        <span class="text-sm text-gray-600 font-semibold">
          Cart Total ({{ cartStore.productCount }} items)
        </span>
        <span class="text-lg font-bold text-gray-800">
          ${{ cartStore.productTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
        </span>
      </div>
      <button @click="cartStore.checkout('product')" class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] outline-none">
        Checkout
        <i class="fa-solid fa-cart-shopping"></i>
      </button>
    </div>

    <teleport to="body">
      <div 
        v-if="selectedProduct" 
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/60 backdrop-blur-sm transition-opacity" 
        @click.self="closeModal"
      >
        <div class="bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
          
          <div class="p-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-20">
            <h2 class="font-bold text-lg text-gray-800 truncate pr-4">{{ selectedProduct.name }}</h2>
            <button @click="closeModal" class="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 flex items-center justify-center transition-colors outline-none shrink-0">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div class="overflow-y-auto flex-1 p-4 pb-8">
            <div class="flex items-end justify-between mb-6 pb-6 border-b border-gray-100">
              <div>
                <p class="text-sm text-gray-500 mb-1">Price</p>
                <div class="text-3xl font-black text-brand">${{ selectedProduct.price_usd }}</div>
              </div>
              
              <div class="w-32">
                <button 
                  v-if="cartStore.getProductQuantity(selectedProduct.id) === 0"
                  @click="cartStore.addProduct(selectedProduct)"
                  class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl transition-colors text-sm flex justify-center items-center gap-2 active:scale-95 outline-none shadow-md"
                >
                  <i class="fa-solid fa-cart-plus"></i> Add
                </button>

                <div v-else class="w-full flex items-center justify-between bg-brand-light border border-brand-light rounded-xl p-1 h-[44px]">
                  <button 
                    @click="cartStore.removeProduct(selectedProduct)"
                    class="w-10 h-full flex items-center justify-center bg-white rounded-lg text-brand font-bold shadow-sm active:scale-95 outline-none"
                  >
                    <i class="fa-solid" :class="cartStore.getProductQuantity(selectedProduct.id) === 1 ? 'fa-trash-can' : 'fa-minus'"></i>
                  </button>
                  <span class="font-bold text-brand-dark text-base w-8 text-center">
                    {{ cartStore.getProductQuantity(selectedProduct.id) }}
                  </span>
                  <button 
                    @click="cartStore.addProduct(selectedProduct)"
                    class="w-10 h-full flex items-center justify-center bg-brand rounded-lg text-white font-bold shadow-sm active:scale-95 outline-none"
                  >
                    <i class="fa-solid fa-plus"></i>
                  </button>
                </div>
              </div>
            </div>

            <div>
              <h3 class="font-bold text-gray-800 mb-3 text-lg">Product Description</h3>
              <div class="product-body text-gray-600 text-sm leading-relaxed" v-html="selectedProduct.body"></div>
            </div>
          </div>
        </div>
      </div>
    </teleport>

    <teleport to="body">
      <div 
        v-if="selectedGalleryProduct" 
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm transition-opacity"
      >
        <div class="absolute top-safe-top left-0 right-0 p-4 flex justify-between items-center z-20">
          <span class="text-white text-sm font-bold tracking-widest opacity-80">
            <template v-if="getImagesArray(selectedGalleryProduct.images).length > 0">
              {{ currentGalleryIndex + 1 }} / {{ getImagesArray(selectedGalleryProduct.images).length }}
            </template>
          </span>
          <button @click="closeGalleryModal" class="w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors outline-none">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <button 
          v-if="getImagesArray(selectedGalleryProduct.images).length > 1 && currentGalleryIndex > 0"
          @click="scrollGallery(-1)"
          class="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center z-20 transition-colors outline-none hidden sm:flex"
        >
          <i class="fa-solid fa-chevron-left"></i>
        </button>

        <div 
          ref="galleryScrollContainer"
          @scroll="onGalleryScroll"
          class="w-full h-full flex overflow-x-auto snap-x snap-mandatory no-scrollbar items-center pb-safe-bottom"
        >
          <div 
            v-if="getImagesArray(selectedGalleryProduct.images).length === 0"
            class="snap-center shrink-0 w-full h-full flex items-center justify-center p-4"
          >
             <i class="fa-solid fa-image text-6xl text-gray-500"></i>
          </div>
          <div 
            v-else
            v-for="img in getImagesArray(selectedGalleryProduct.images)" 
            :key="img"
            class="snap-center shrink-0 w-full h-full flex items-center justify-center p-4"
          >
            <img :src="img" class="max-w-full max-h-full object-contain" @error="(e) => e.target.style.display='none'" />
          </div>
        </div>

        <button 
          v-if="getImagesArray(selectedGalleryProduct.images).length > 1 && currentGalleryIndex < getImagesArray(selectedGalleryProduct.images).length - 1"
          @click="scrollGallery(1)"
          class="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center z-20 transition-colors outline-none hidden sm:flex"
        >
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        
      </div>
    </teleport>

  </div>
</template>

<style scoped>
/* Hidden scrollbar utilities but keeps horizontal scrolling enabled */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Modal Animation */
.animate-slide-up {
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Basic styling for injected HTML to ensure it looks good within the Tailwind ecosystem */
.product-body :deep(h1), 
.product-body :deep(h2), 
.product-body :deep(h3) {
  font-weight: 700;
  color: #1f2937;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

.product-body :deep(h1) { font-size: 1.5rem; }
.product-body :deep(h2) { font-size: 1.25rem; }
.product-body :deep(h3) { font-size: 1.125rem; }

.product-body :deep(p) {
  margin-bottom: 1em;
}

.product-body :deep(ul),
.product-body :deep(ol) {
  margin-left: 1.5em;
  margin-bottom: 1em;
}

.product-body :deep(ul) { list-style-type: disc; }
.product-body :deep(ol) { list-style-type: decimal; }

.product-body :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.product-body :deep(strong), 
.product-body :deep(b) {
  font-weight: 600;
  color: #374151;
}
</style>