import comingSoonImg from '@/assets/images/coming-soon.png'

interface ComingSoonPageProps {
  moduleName: string
}

export function ComingSoonPage({ moduleName }: ComingSoonPageProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <img
        src={comingSoonImg}
        alt="Segera Hadir"
        className="mb-8 h-64 w-64 rounded-2xl object-cover"
      />
      <h2 className="mb-2 text-2xl font-bold text-gray-900">Segera Hadir</h2>
      <p className="max-w-md text-gray-500">
        Modul <span className="font-semibold text-gray-700">{moduleName}</span>{' '}
        sedang dalam pengembangan. Nantikan update selanjutnya!
      </p>
    </div>
  )
}
