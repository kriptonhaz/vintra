import { AiGenerateScreen } from '~/components/AiGenerateScreen'
import {
  useDeleteSpanduk,
  useGenerateSpanduk,
  useSpanduks,
  useSpandukStatus,
} from '~/lib/creative'

export default function SpandukGenerate() {
  const status = useSpandukStatus()
  const items = useSpanduks()
  const generate = useGenerateSpanduk()
  const remove = useDeleteSpanduk()

  return (
    <AiGenerateScreen
      title="Spanduk"
      subtitle="Generate banner besar untuk depan toko / iklan"
      promptPlaceholder="Mis. Spanduk promo Lebaran kedai kopi, headline 'Diskon 30%', warna emas + hijau"
      webFieldsHint="Untuk pilih ukuran banner (3x1m, 6x1m), tata letak teks + logo, dan upload aset — pakai editor web."
      status={{
        isLoading: status.isLoading,
        error: status.error,
        data: status.data,
      }}
      items={{
        isLoading: items.isLoading,
        isFetching: items.isFetching,
        error: items.error,
        data: items.data,
        refetch: items.refetch,
      }}
      generate={generate}
      deleteItem={{ mutate: (id: string) => remove.mutate(id) }}
      squareAspect={false}
    />
  )
}
