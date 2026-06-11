/**
 * Admin article editor (issue #206). `articleId === 'new'` opens a
 * blank editor; any other value loads that article for editing.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getArticleAdmin } from '@/server/functions/articles'
import { ArticleEditor } from '@/components/admin/article-editor'

export const Route = createFileRoute('/admin/articles/$articleId')({
  loader: async ({ params }) => {
    if (params.articleId === 'new') return { article: null }
    const article = await getArticleAdmin({ data: { id: params.articleId } })
    return { article }
  },
  component: ArticleEditorPage,
})

function ArticleEditorPage() {
  const { article } = Route.useLoaderData()
  return <ArticleEditor article={article} />
}
