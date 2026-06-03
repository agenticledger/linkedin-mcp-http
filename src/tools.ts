import { z } from 'zod';
import { readFileSync, statSync } from 'fs';
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

  // --- Video Upload ---
  {
    name: 'video_initialize_upload',
    description: 'Initialize a video upload with LinkedIn. Returns video URN and upload URL.',
    inputSchema: z.object({
      file_size_bytes: z.number().describe('Size of the MP4 file in bytes'),
      owner: z.string().optional().describe('Person URN (urn:li:person:{id}). Defaults to authenticated user.'),
    }),
    handler: async (client, args) => {
      let ownerUrn = args.owner;
      if (!ownerUrn) {
        const userInfo = await client.getUserInfo();
        ownerUrn = `urn:li:person:${userInfo.sub}`;
      }
      const result = await client.initializeVideoUpload(ownerUrn!, args.file_size_bytes);
      const value = result.value || result;
      return {
        video: value.video,
        uploadUrl: value.uploadInstructions?.[0]?.uploadUrl,
        uploadUrlsExpireAt: value.uploadUrlsExpireAt,
      };
    },
  },
  {
    name: 'video_upload_binary',
    description: 'Upload an MP4 file to the upload URL from video_initialize_upload. Returns the ETag needed for finalization.',
    inputSchema: z.object({
      upload_url: z.string().describe('The upload URL from the initialize step'),
      file_path: z.string().describe('Local path to the MP4 file'),
    }),
    handler: async (client, args) => {
      const fileData = readFileSync(args.file_path);
      const result = await client.uploadVideoBinary(args.upload_url, new Uint8Array(fileData));
      return result;
    },
  },
  {
    name: 'video_finalize_upload',
    description: 'Finalize a video upload after binary has been uploaded.',
    inputSchema: z.object({
      video: z.string().describe('The video URN from the initialize step'),
      etag: z.string().describe('The ETag from the upload step'),
    }),
    handler: async (client, args) => client.finalizeVideoUpload(args.video, args.etag),
  },
  {
    name: 'video_get_status',
    description: 'Check video processing status. Status will be PROCESSING, AVAILABLE, or FAILED.',
    inputSchema: z.object({
      video: z.string().describe('The video URN to check'),
    }),
    handler: async (client, args) => client.getVideoStatus(args.video),
  },
  {
    name: 'post_create_video',
    description: 'Create a LinkedIn post with an attached video. Video must be status AVAILABLE first.',
    inputSchema: z.object({
      text: z.string().describe('Post commentary/text'),
      video_urn: z.string().describe('The video URN (must be AVAILABLE)'),
      title: z.string().optional().describe('Video title (shown as overlay)'),
      visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().describe('Post visibility (default PUBLIC)'),
      author: z.string().optional().describe('Person URN (urn:li:person:{id}). Defaults to authenticated user.'),
    }),
    handler: async (client, args) => {
      let authorUrn = args.author;
      if (!authorUrn) {
        const userInfo = await client.getUserInfo();
        authorUrn = `urn:li:person:${userInfo.sub}`;
      }
      const result = await client.createVideoPost({
        authorUrn: authorUrn!,
        text: args.text,
        videoUrn: args.video_urn,
        title: args.title,
        visibility: args.visibility,
      });
      const postUrn = result.id || result;
      return {
        postUrn,
        url: typeof postUrn === 'string' ? `https://www.linkedin.com/feed/update/${postUrn}` : result,
      };
    },
  },
  {
    name: 'video_upload_and_post',
    description: 'All-in-one: upload a video file and create a LinkedIn post with it. Handles initialize, upload, finalize, status polling, and post creation.',
    inputSchema: z.object({
      file_path: z.string().describe('Local path to MP4 file'),
      text: z.string().describe('Post text'),
      title: z.string().optional().describe('Video title'),
      visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional().describe('Post visibility (default PUBLIC)'),
    }),
    handler: async (client, args) => {
      // 1. Get authenticated user
      const userInfo = await client.getUserInfo();
      const ownerUrn = `urn:li:person:${userInfo.sub}`;

      // 2. Get file size
      const fileStat = statSync(args.file_path);
      const fileSizeBytes = fileStat.size;

      // 3. Initialize upload
      const initResult = await client.initializeVideoUpload(ownerUrn, fileSizeBytes);
      const value = initResult.value || initResult;
      const videoUrn = value.video;
      const uploadUrl = value.uploadInstructions?.[0]?.uploadUrl;

      if (!videoUrn || !uploadUrl) {
        throw new Error('Failed to initialize video upload — missing video URN or upload URL');
      }

      // 4. Upload binary
      const fileData = readFileSync(args.file_path);
      const uploadResult = await client.uploadVideoBinary(uploadUrl, new Uint8Array(fileData));
      const etag = uploadResult.etag;

      // 5. Finalize
      await client.finalizeVideoUpload(videoUrn, etag);

      // 6. Poll for AVAILABLE status (max 60 seconds)
      let status = 'PROCESSING';
      const maxWait = 60_000;
      const start = Date.now();
      while (status === 'PROCESSING' && (Date.now() - start) < maxWait) {
        const statusResult = await client.getVideoStatus(videoUrn);
        status = statusResult.status || 'PROCESSING';
        if (status === 'AVAILABLE') break;
        if (status === 'FAILED') throw new Error('Video processing failed on LinkedIn');
        // Wait 2 seconds before next poll
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (status !== 'AVAILABLE') {
        throw new Error(`Video still processing after ${maxWait / 1000}s. Video URN: ${videoUrn} — try post_create_video manually later.`);
      }

      // 7. Create post
      const postResult = await client.createVideoPost({
        authorUrn: ownerUrn,
        text: args.text,
        videoUrn,
        title: args.title,
        visibility: args.visibility,
      });

      const postUrn = postResult.id || postResult;
      return {
        postUrn,
        videoUrn,
        url: typeof postUrn === 'string' ? `https://www.linkedin.com/feed/update/${postUrn}` : postResult,
        status: 'published',
      };
    },
  },
];
