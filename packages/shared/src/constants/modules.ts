export const MODULES = {
  hpp: { name: 'HPP Calculator', free: true, price: 0, billingUnit: 'flat' },
  pos: { name: 'Point of Sales', free: false, price: 79000, billingUnit: 'flat' },
  inventory: { name: 'Inventaris', free: false, price: 49000, billingUnit: 'flat' },
  attendance: { name: 'Absensi Karyawan', free: false, price: 5000, billingUnit: 'per_staff_monthly' },
  finance: { name: 'Laporan Keuangan', free: false, price: 59000, billingUnit: 'flat' },
  booking: { name: 'Booking & Reservasi', free: true, price: 0, billingUnit: 'flat' },
} as const

export type ModuleKey = keyof typeof MODULES

export const UNITS = [
  { value: 'gram', label: 'Gram (g)' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'ml', label: 'Mililiter (ml)' },
  { value: 'liter', label: 'Liter (L)' },
  { value: 'pcs', label: 'Pieces (pcs)' },
  { value: 'pack', label: 'Pack' },
  { value: 'box', label: 'Box' },
  { value: 'sachet', label: 'Sachet' },
  { value: 'botol', label: 'Botol' },
  { value: 'kaleng', label: 'Kaleng' },
  { value: 'lembar', label: 'Lembar' },
  { value: 'porsi', label: 'Porsi' },
  { value: 'sendok', label: 'Sendok' },
  { value: 'cup', label: 'Cup' },
] as const

export const OVERHEAD_PERIODS = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
] as const

export const ALLOCATION_TYPES = [
  { value: 'per_product', label: 'Per Produk (dibagi rata)' },
  { value: 'percentage', label: 'Persentase dari HPP' },
] as const
