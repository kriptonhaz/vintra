/**
 * Post-sale success screen. Lands here after createSale succeeds.
 *
 * Three actions surface:
 *   - WhatsApp share: opens wa.me with a pre-formatted text receipt.
 *     The customer picks the contact themselves; we don't have their
 *     phone number stored unless they typed one in (skipped for v1).
 *   - Download / share PDF: hits getSaleReceiptPDF, writes the base64
 *     to disk via expo-file-system, then opens the native share sheet
 *     via expo-sharing. Works for "save to Files" + WhatsApp document
 *     attach + email.
 *   - Transaksi Baru: clears the cart, kicks back to the catalog.
 */
import { useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Alert, Linking } from 'react-native'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { CheckCircle2, Download, MessageCircle, Plus } from '~/lib/icons'
import {
  Button,
  Card,
  H1,
  H4,
  Paragraph,
  Spinner,
  YStack,
} from 'tamagui'
import { useReceiptPdf } from '../../../lib/pos'
import { useTenant } from '../../../lib/tenant-context'
import { formatRupiah } from '../../../lib/currency'

export default function SuccessScreen() {
  const router = useRouter()
  const { id, saleNumber, total } = useLocalSearchParams<{
    id: string
    saleNumber?: string
    total?: string
  }>()
  const { state: tenantState } = useTenant()
  const businessName =
    tenantState.status === 'ready' ? tenantState.tenant.businessName : 'Usaha'
  const totalNum = Number(total ?? '0')
  const receiptPdf = useReceiptPdf()
  const [sharing, setSharing] = useState(false)

  async function handleWhatsappShare() {
    // Plain wa.me link — no recipient phone. Opens WhatsApp's contact
    // picker, user chooses who to send to. Pre-fills the message body.
    const lines = [
      `*${businessName}*`,
      `Struk #${saleNumber ?? id.slice(0, 8)}`,
      `Total: ${formatRupiah(totalNum)}`,
      `Terima kasih atas pembelian Anda!`,
    ]
    const url = `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Gagal buka WhatsApp', 'WhatsApp tidak terinstall di HP ini.')
    }
  }

  async function handlePdfShare() {
    if (sharing) return
    setSharing(true)
    try {
      const { dataUrl, fileName } = await receiptPdf.mutateAsync(id)
      // Strip the data: URI prefix, write base64 to a temp file.
      const base64 = dataUrl.replace(/^data:application\/pdf;base64,/, '')
      const path = FileSystem.cacheDirectory + fileName
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const ok = await Sharing.isAvailableAsync()
      if (!ok) {
        Alert.alert(
          'Tidak bisa share file',
          'HP ini tidak punya aplikasi yang bisa menerima file PDF.',
        )
        return
      }
      await Sharing.shareAsync(path, {
        mimeType: 'application/pdf',
        dialogTitle: 'Bagikan struk',
        UTI: 'com.adobe.pdf',
      })
    } catch (err) {
      Alert.alert(
        'Gagal share PDF',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    } finally {
      setSharing(false)
    }
  }

  function handleNewSale() {
    router.replace('/(tabs)/pos')
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Pembayaran Sukses',
          // Block back-button → success screen is terminal; user should
          // explicitly pick "Transaksi Baru" so we don't accidentally
          // dump them back on the cart with a stale state.
          headerBackVisible: false,
        }}
      />
      <YStack flex={1} p="$5" gap="$4" bg="$background">
        <Card bordered padded gap="$3" bg="$green2" borderColor="$green8">
          <YStack ai="center" gap="$2" py="$2">
            <CheckCircle2 size={56} color="$green10" />
            <H1 fontSize="$8" col="$green11">Sukses!</H1>
            <Paragraph col="$green11" fontSize="$3">
              Pembayaran sebesar
            </Paragraph>
            <H1 fontSize="$10" col="$green11" fontWeight="800">
              {formatRupiah(totalNum)}
            </H1>
            <Paragraph col="$color11" fontSize="$2">
              Struk #{saleNumber ?? id.slice(0, 8)}
            </Paragraph>
          </YStack>
        </Card>

        <YStack gap="$2" pt="$2">
          <H4>Bagikan struk?</H4>
          <Paragraph fontSize="$2" col="$color10">
            Pelanggan bisa simpan struk untuk catatan.
          </Paragraph>
        </YStack>

        <Button size="$5" bg="#006b32" color="white" borderWidth={0} onPress={handleWhatsappShare}>
          <MessageCircle size={18} />
          Kirim via WhatsApp
        </Button>

        <Button
          size="$5"
          variant="outlined"
          disabled={sharing}
          onPress={handlePdfShare}
        >
          {sharing ? (
            <Spinner />
          ) : (
            <>
              <Download size={18} />
              Unduh / Bagikan PDF
            </>
          )}
        </Button>

        <YStack flex={1} />

        <Button size="$5" bg="#006b32" color="white" borderWidth={0} onPress={handleNewSale}>
          <Plus size={18} />
          Transaksi Baru
        </Button>
      </YStack>
    </>
  )
}
