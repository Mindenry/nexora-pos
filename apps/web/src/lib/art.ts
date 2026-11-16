export interface CategoryArt {
  key: string;
  labelTh: string;
  labelEn: string;
  url: string;
}

export const CATEGORY_ART: CategoryArt[] = [
  { key: 'coffee', labelTh: 'กาแฟ', labelEn: 'Coffee', url: '/images/categories/coffee.svg' },
  { key: 'drinks', labelTh: 'เครื่องดื่ม', labelEn: 'Drinks', url: '/images/categories/drinks.svg' },
  { key: 'snacks', labelTh: 'ขนม', labelEn: 'Snacks', url: '/images/categories/snacks.svg' },
  { key: 'dry-goods', labelTh: 'อาหารแห้ง', labelEn: 'Dry goods', url: '/images/categories/dry-goods.svg' },
  { key: 'condiments', labelTh: 'เครื่องปรุง', labelEn: 'Condiments', url: '/images/categories/condiments.svg' },
  { key: 'home-care', labelTh: 'ของใช้ในบ้าน', labelEn: 'Home care', url: '/images/categories/home-care.svg' },
  { key: 'cosmetics', labelTh: 'เครื่องสำอาง', labelEn: 'Cosmetics', url: '/images/categories/cosmetics.svg' },
  { key: 'electronics', labelTh: 'อิเล็กทรอนิกส์', labelEn: 'Electronics', url: '/images/categories/electronics.svg' },
  { key: 'apparel', labelTh: 'เสื้อผ้า', labelEn: 'Apparel', url: '/images/categories/apparel.svg' },
  { key: 'stationery', labelTh: 'เครื่องเขียน', labelEn: 'Stationery', url: '/images/categories/stationery.svg' },
  { key: 'health', labelTh: 'สุขภาพ', labelEn: 'Health', url: '/images/categories/health.svg' },
  { key: 'pet', labelTh: 'สัตว์เลี้ยง', labelEn: 'Pet supplies', url: '/images/categories/pet.svg' },
];

export const SHOWCASE_ART = [CATEGORY_ART[0]!, CATEGORY_ART[5]!, CATEGORY_ART[7]!, CATEGORY_ART[8]!];

export function categoryArt(name: string): string | undefined {
  return CATEGORY_ART.find((art) => art.labelTh === name || art.labelEn === name)?.url;
}
