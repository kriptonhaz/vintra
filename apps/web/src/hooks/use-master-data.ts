import { useQuery } from '@tanstack/react-query'
import { getHppUnits } from '@/server/functions/master-data'
import { getMaterials, getSuppliers, getProducts, getTenantCategories } from '@/server/functions/hpp'

export function useHppUnits() {
  return useQuery({
    queryKey: ['master', 'hpp-units'],
    queryFn: () => getHppUnits(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useTenantCategories() {
  return useQuery({
    queryKey: ['tenant', 'categories'],
    queryFn: () => getTenantCategories(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useMaterials() {
  return useQuery({
    queryKey: ['tenant', 'materials'],
    queryFn: () => getMaterials(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['tenant', 'suppliers'],
    queryFn: () => getSuppliers(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useProducts() {
  return useQuery({
    queryKey: ['tenant', 'products'],
    queryFn: () => getProducts(),
    staleTime: 5 * 60 * 1000,
  })
}
