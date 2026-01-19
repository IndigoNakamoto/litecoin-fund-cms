import type { CollectionConfig } from 'payload'
import { ContributorDetailView } from '../components/views/ContributorDetail'
import { LinkFieldComponent } from '../components/fields/LinkFieldComponent'

export const Contributors: CollectionConfig = {
  slug: 'contributors',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'updatedAt'],
    components: {
      views: {
        Detail: ContributorDetailView,
      },
    },
  },
  access: {
    read: () => true,
    update: () => true, // Allow updates for migration scripts
    create: () => true, // Allow creates for migration scripts
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'URL-friendly identifier',
      },
    },
    {
      name: 'profilePicture',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'twitterLink',
      type: 'text',
      label: 'Twitter/X Link',
      admin: {
        description: 'Twitter/X profile URL (e.g., https://twitter.com/username)',
        position: 'sidebar',
        components: {
          Field: LinkFieldComponent,
        },
      },
    },
    {
      name: 'discordLink',
      type: 'text',
      label: 'Discord Link',
      admin: {
        description: 'Discord profile URL or invite link',
        position: 'sidebar',
        components: {
          Field: LinkFieldComponent,
        },
      },
    },
    {
      name: 'githubLink',
      type: 'text',
      label: 'GitHub Link',
      admin: {
        description: 'GitHub profile URL (e.g., https://github.com/username)',
        position: 'sidebar',
        components: {
          Field: LinkFieldComponent,
        },
      },
    },
    {
      name: 'youtubeLink',
      type: 'text',
      label: 'YouTube Link',
      admin: {
        description: 'YouTube channel URL',
        position: 'sidebar',
        components: {
          Field: LinkFieldComponent,
        },
      },
    },
    {
      name: 'linkedinLink',
      type: 'text',
      label: 'LinkedIn Link',
      admin: {
        description: 'LinkedIn profile URL',
        position: 'sidebar',
        components: {
          Field: LinkFieldComponent,
        },
      },
    },
    {
      name: 'email',
      type: 'email',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
