import type { Request, Response } from 'express';
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '@/shared/response/send-response.util';
import type { ProviderService } from '@/modules/provider/provider.service';
import type {
  CreateProviderInput,
  ImportProvidersInput,
  ListActiveProvidersQuery,
  ListProvidersQuery,
  ProviderIdParam,
  UpdateProviderInput,
} from '@/modules/provider/provider.schema';

/**
 * The reference controller for this template.
 *
 * Every method does the same three things: read validated input, call one
 * service method, send a standard response. There is no try/catch (Express 5
 * forwards rejections), no Prisma, no business rule, and no manually built
 * error body. If a controller method grows past a handful of lines, the logic
 * that made it grow belongs in the service.
 *
 * No abstract base controller: these five methods share no behaviour worth
 * inheriting, and a base class would hide the one thing a reader wants to see.
 */
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  getProviders = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListProvidersQuery;
    const { providers, meta } = await this.providerService.listProviders(query);
    sendPaginated(res, providers, meta);
  };

  getActiveProviders = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListActiveProvidersQuery;
    const { providers, meta } = await this.providerService.listActiveProviders(query);
    sendPaginated(res, providers, meta);
  };

  getProvider = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ProviderIdParam;
    const provider = await this.providerService.getProviderById(id);
    sendSuccess(res, provider);
  };

  createProvider = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateProviderInput;
    const provider = await this.providerService.createProvider(input);
    sendCreated(res, provider, 'Provider created successfully.');
  };

  /** Atomic bulk import: either every row lands or none do. */
  importProviders = async (req: Request, res: Response): Promise<void> => {
    const { providers } = req.body as ImportProvidersInput;
    const created = await this.providerService.importProviders(providers);
    sendCreated(res, created, `${created.length} providers imported successfully.`);
  };

  updateProvider = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ProviderIdParam;
    const input = req.body as UpdateProviderInput;
    const provider = await this.providerService.updateProvider(id, input);
    sendSuccess(res, provider, 'Provider updated successfully.');
  };

  deleteProvider = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as ProviderIdParam;
    await this.providerService.deleteProvider(id);
    sendNoContent(res);
  };
}
