import { AiGenerateScreen } from '~/components/AiGenerateScreen'
import {
  useDeleteKontenImage,
  useGenerateKonten,
  useKontenImages,
  useKontenLedger,
} from '~/lib/creative'

export default function KontenGenerate() {
  const ledger = useKontenLedger()
  const images = useKontenImages()
  const generate = useGenerateKonten()
  const remove = useDeleteKontenImage()

  return (
    <AiGenerateScreen
      title="Konten"
      subtitle="Generate foto produk + iklan"
      promptPlaceholder="Mis. Foto cangkir kopi latte di atas meja kayu, suasana hangat, cahaya pagi"
      webFieldsHint="Untuk pilih gaya, palet warna, rasio aspek, dan referensi gambar — gunakan editor web."
      status={{
        isLoading: ledger.isLoading,
        error: ledger.error,
        data: {
          enabled: ledger.data !== undefined,
          monthlyCap: ledger.data?.monthlyCap ?? null,
          used: ledger.data?.used ?? 0,
        },
      }}
      items={{
        isLoading: images.isLoading,
        isFetching: images.isFetching,
        error: images.error,
        data: images.data,
        refetch: images.refetch,
      }}
      generate={generate}
      deleteItem={{
        mutate: (id: string) => remove.mutate(id),
      }}
      squareAspect
    />
  )
}
