import { z } from 'zod';
import { LinkedInClient } from './api-client.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (client: LinkedInClient, args: any) => Promise<any>;
}

export const tools: ToolDef[] = [
  // --- Profile ---
  {
    name: 'profile_get_userinfo',
    description: 'Get authenticated user profile and email',
    inputSchema: z.object({}),
    handler: async (client) => client.getUserInfo(),
  },
  // --- Posts ---
  {
    name: 'post_create_text',
    description: 'Create a text-only LinkedIn post',
    inputSchema: z.object({
      author_urn: z.string().describe('Author URN (urn:li:person:{id})'),
      text: z.string().describe('Post text content'),
      visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().describe('Post visibility'),
    }),
    handler: async (client, args) =>
      client.createPost({
        authorUrn: args.author_urn,
        text: args.text,
        visibility: args.visibility,
      }),
  },
  {
    name: 'post_create_article',
    description: 'Create a LinkedIn post with a link/article',
    inputSchema: z.object({
      author_urn: z.string().describe('Author URN (urn:li:person:{id})'),
      text: z.string().describe('Post text content'),
      article_url: z.string().describe('URL of the article to share'),
      article_title: z.string().optional().describe('Article title'),
      article_description: z.string().optional().describe('Article description'),
      visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().describe('Post visibility'),
    }),
    handler: async (client, args) =>
      client.createArticlePost({
        authorUrn: args.author_urn,
        text: args.text,
        articleUrl: args.article_url,
        articleTitle: args.article_title,
        articleDescription: args.article_description,
        visibility: args.visibility,
      }),
  },
  {
    name: 'post_create_image',
    description: 'Create a LinkedIn post with an image',
    inputSchema: z.object({
      author_urn: z.string().describe('Author URN (urn:li:person:{id})'),
      text: z.string().describe('Post text content'),
      image_urn: z.string().describe('Image URN from image upload'),
      alt_text: z.string().optional().describe('Alt text for image'),
      visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().describe('Post visibility'),
    }),
    handler: async (client, args) =>
      client.createImagePost({
        authorUrn: args.author_urn,
        text: args.text,
        imageUrn: args.image_urn,
        altText: args.alt_text,
        visibility: args.visibility,
      }),
  },
  {
    name: 'post_get',
    description: 'Get a specific post by URN',
    inputSchema: z.object({
      post_urn: z.string().describe('Post URN (urn:li:share:{id} or urn:li:ugcPost:{id})'),
    }),
    handler: async (client, args) => client.getPost(args.post_urn),
  },
  {
    name: 'post_delete',
    description: 'Delete a post by URN',
    inputSchema: z.object({
      post_urn: z.string().describe('Post URN to delete'),
    }),
    handler: async (client, args) => client.deletePost(args.post_urn),
  },
  {
    name: 'post_list',
    description: 'List posts by author (needs r_member_social)',
    inputSchema: z.object({
      author_urn: z.string().describe('Author URN (urn:li:person:{id})'),
      count: z.number().optional().describe('Number of posts to return (max 100)'),
      start: z.number().optional().describe('Offset for pagination'),
    }),
    handler: async (client, args) => client.listPosts(args.author_urn, args.count, args.start),
  },

  // --- Image Upload ---
  {
    name: 'image_initialize_upload',
    description: 'Initialize an image upload for a post',
    inputSchema: z.object({
      owner_urn: z.string().describe('Owner URN (urn:li:person:{id})'),
    }),
    handler: async (client, args) => client.initializeImageUpload(args.owner_urn),
  },

  // --- Reactions ---
  {
    name: 'reaction_create',
    description: 'Like a LinkedIn post',
    inputSchema: z.object({
      actor_urn: z.string().describe('Actor URN (urn:li:person:{id})'),
      post_urn: z.string().describe('Post URN to like'),
    }),
    handler: async (client, args) => client.createReaction(args.actor_urn, args.post_urn, 'LIKE'),
  },
  {
    name: 'reaction_delete',
    description: 'Remove a like from a post',
    inputSchema: z.object({
      actor_urn: z.string().describe('Actor URN (urn:li:person:{id})'),
      post_urn: z.string().describe('Post URN'),
    }),
    handler: async (client, args) => client.deleteReaction(args.actor_urn, args.post_urn),
  },
  {
    name: 'reaction_list',
    description: 'Get likes on a post (needs r_member_social)',
    inputSchema: z.object({
      post_urn: z.string().describe('Post URN'),
      count: z.number().optional().describe('Number of likes to return'),
      start: z.number().optional().describe('Offset for pagination'),
    }),
    handler: async (client, args) => client.getReactions(args.post_urn, args.count, args.start),
  },

  // --- Comments ---
  {
    name: 'comment_create',
    description: 'Comment on a LinkedIn post',
    inputSchema: z.object({
      post_urn: z.string().describe('Post URN to comment on'),
      actor_urn: z.string().describe('Actor URN (urn:li:person:{id})'),
      text: z.string().describe('Comment text'),
    }),
    handler: async (client, args) => client.createComment(args.post_urn, args.actor_urn, args.text),
  },
  {
    name: 'comment_list',
    description: 'Get comments on a post',
    inputSchema: z.object({
      post_urn: z.string().describe('Post URN'),
      count: z.number().optional().describe('Number of comments to return'),
      start: z.number().optional().describe('Offset for pagination'),
    }),
    handler: async (client, args) => client.getComments(args.post_urn, args.count, args.start),
  },
  {
    name: 'comment_delete',
    description: 'Delete a comment from a post',
    inputSchema: z.object({
      post_urn: z.string().describe('Post URN'),
      comment_id: z.string().describe('Comment ID to delete'),
    }),
    handler: async (client, args) => client.deleteComment(args.post_urn, args.comment_id),
  },
];
