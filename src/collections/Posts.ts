import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['xPostLink', 'projects', 'updatedAt'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'xPostLink',
      type: 'text',
      admin: {
        description: 'X/Twitter post URL',
      },
    },
    {
      name: 'youtubeLink',
      type: 'text',
      admin: {
        description: 'YouTube video URL',
      },
    },
    {
      name: 'redditLink',
      type: 'text',
      admin: {
        description: 'Reddit post URL',
      },
    },
    {
      name: 'projects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
      admin: {
        description: 'Related projects',
      },
    },
  ],
}
