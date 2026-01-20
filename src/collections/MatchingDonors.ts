import type { CollectionConfig } from 'payload'

export const MatchingDonors: CollectionConfig = {
  slug: 'matching-donors',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'matchingType', 'updatedAt'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'webflowId',
      type: 'text',
      unique: true,
      admin: {
        description: 'Original Webflow item ID (for migration tracking)',
        position: 'sidebar',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Name of the matching donor',
      },
    },
    {
      name: 'matchingType',
      type: 'select',
      required: true,
      options: [
        { label: 'All Projects', value: 'all-projects' },
        { label: 'Per Project', value: 'per-project' },
      ],
      admin: {
        description: 'Whether matching applies to all projects or specific projects',
      },
    },
    {
      name: 'totalMatchingAmount',
      type: 'number',
      required: true,
      admin: {
        description: 'Total amount available for matching (in USD)',
      },
      defaultValue: 0,
    },
    {
      name: 'supportedProjects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
      admin: {
        description: 'Projects this donor supports (only used when matchingType is "Per Project")',
      },
    },
    {
      name: 'startDate',
      type: 'date',
      required: true,
      admin: {
        description: 'Start date for the matching period',
      },
    },
    {
      name: 'endDate',
      type: 'date',
      required: true,
      admin: {
        description: 'End date for the matching period',
      },
    },
    {
      name: 'multiplier',
      type: 'number',
      admin: {
        description: 'Multiplier for matching (e.g., 2x means $1 donation = $2 match)',
      },
      defaultValue: 1,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ],
      defaultValue: 'inactive',
      admin: {
        description: 'Status of the matching donor',
      },
    },
    {
      name: 'contributor',
      type: 'relationship',
      relationTo: 'contributors',
      admin: {
        description: 'Optional contributor associated with this matching donor',
      },
    },
  ],
}
