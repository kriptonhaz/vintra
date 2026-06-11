import { AiGenerateScreen } from '~/components/AiGenerateScreen'
import {
  useDeleteLogo,
  useGenerateLogo,
  useLogos,
  useLogoStatus,
} from '~/lib/creative'

export default function LogoGenerate() {
  const status = useLogoStatus()
  const items = useLogos()
  const generate = useGenerateLogo()
  const remove = useDeleteLogo()

  return (
    <AiGenerateScreen
      title="Logo"
      subtitle="Generate logo brand otomatis"
      promptPlaceholder="Mis. Logo kedai kopi bernama 'Senja Hangat', gaya minimalis modern, warna coklat tua"
      webFieldsHint="Untuk pilih gaya (mascot, monogram, dll), palet warna, dan font referensi — pakai editor web."
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
      squareAspect
    />
  )
}
