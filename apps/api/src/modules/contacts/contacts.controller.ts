import {
  bulkContactsRequestSchema,
  changeConsentRequestSchema,
  configureImportRequestSchema,
  consentSettingsSchema,
  countContactsRequestSchema,
  createContactRequestSchema,
  createExportRequestSchema,
  createImportRequestSchema,
  createNoteRequestSchema,
  createPropertyRequestSchema,
  createSegmentRequestSchema,
  createTagRequestSchema,
  importUploadRequestSchema,
  searchContactsRequestSchema,
  updateContactRequestSchema,
  updatePropertyRequestSchema,
  updateSegmentRequestSchema,
  updateTagRequestSchema,
} from '@fenwira/contracts'
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { ContactCatalogService } from './catalog.service'
import { ContactsService } from './contacts.service'
import { ExportsService } from './exports'
import { ImportsService } from './imports/imports.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema)
type In<T extends z.ZodType> = z.infer<T>

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Post('search')
  @RequirePermission('contacts.read')
  @HttpCode(200)
  async search(
    @Body(pipe(searchContactsRequestSchema)) body: In<typeof searchContactsRequestSchema>,
  ) {
    const { items, page } = await this.contacts.search(body)
    return { data: items, page }
  }

  @Post('count')
  @RequirePermission('contacts.read')
  @HttpCode(200)
  async count(@Body(pipe(countContactsRequestSchema)) body: In<typeof countContactsRequestSchema>) {
    return { data: { count: await this.contacts.count(body.filter, body.q) } }
  }

  @Post()
  @RequirePermission('contacts.write')
  @HttpCode(201)
  async create(
    @Body(pipe(createContactRequestSchema)) body: In<typeof createContactRequestSchema>,
  ) {
    return { data: await this.contacts.create(body) }
  }

  @Post('bulk')
  @RequirePermission('contacts.write')
  @HttpCode(200)
  async bulk(@Body(pipe(bulkContactsRequestSchema)) body: In<typeof bulkContactsRequestSchema>) {
    return { data: await this.contacts.bulk(body) }
  }

  @Get(':id')
  @RequirePermission('contacts.read')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.contacts.get(id) }
  }

  @Patch(':id')
  @RequirePermission('contacts.write')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateContactRequestSchema)) body: In<typeof updateContactRequestSchema>,
  ) {
    return { data: await this.contacts.update(id, body) }
  }

  @Delete(':id')
  @RequirePermission('contacts.delete')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.contacts.remove(id)
  }

  @Get(':id/activities')
  @RequirePermission('contacts.read')
  async activities(@Param('id', uuidParam) id: string, @Query('cursor') cursor?: string) {
    const { items, nextCursor } = await this.contacts.activities(id, cursor)
    return { data: items, page: { nextCursor, hasMore: !!nextCursor, limit: 50 } }
  }

  @Get(':id/consents')
  @RequirePermission('contacts.read')
  async consents(@Param('id', uuidParam) id: string) {
    return { data: await this.contacts.consents(id) }
  }

  @Post(':id/consents')
  @RequirePermission('contacts.write')
  @HttpCode(200)
  async changeConsent(
    @Param('id', uuidParam) id: string,
    @Body(pipe(changeConsentRequestSchema)) body: In<typeof changeConsentRequestSchema>,
  ) {
    return { data: await this.contacts.changeConsent(id, body) }
  }

  @Get(':id/conversations')
  @RequirePermission('contacts.read')
  async conversations(@Param('id', uuidParam) id: string) {
    return { data: await this.contacts.conversations(id) }
  }

  @Get(':id/notes')
  @RequirePermission('contacts.read')
  async notes(@Param('id', uuidParam) id: string) {
    return { data: await this.contacts.notes(id) }
  }

  @Post(':id/notes')
  @RequirePermission('contacts.write')
  @HttpCode(201)
  async addNote(
    @Param('id', uuidParam) id: string,
    @Body(pipe(createNoteRequestSchema)) body: In<typeof createNoteRequestSchema>,
  ) {
    return { data: await this.contacts.addNote(id, body.body) }
  }
}

@Controller()
export class ContactCatalogController {
  constructor(private readonly catalog: ContactCatalogService) {}

  @Get('tags')
  @RequirePermission('contacts.read')
  async tags() {
    return { data: await this.catalog.listTags() }
  }

  @Post('tags')
  @RequirePermission('contacts.write')
  @HttpCode(201)
  async createTag(@Body(pipe(createTagRequestSchema)) body: In<typeof createTagRequestSchema>) {
    return { data: await this.catalog.createTag(body) }
  }

  @Patch('tags/:id')
  @RequirePermission('contacts.write')
  async updateTag(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateTagRequestSchema)) body: In<typeof updateTagRequestSchema>,
  ) {
    return { data: await this.catalog.updateTag(id, body) }
  }

  @Delete('tags/:id')
  @RequirePermission('contacts.write')
  @HttpCode(204)
  async deleteTag(@Param('id', uuidParam) id: string): Promise<void> {
    await this.catalog.deleteTag(id)
  }

  @Get('contact-properties')
  @RequirePermission('contacts.read')
  async properties() {
    return { data: await this.catalog.listProperties() }
  }

  @Post('contact-properties')
  @RequirePermission('contacts.properties.manage')
  @HttpCode(201)
  async createProperty(
    @Body(pipe(createPropertyRequestSchema)) body: In<typeof createPropertyRequestSchema>,
  ) {
    return { data: await this.catalog.createProperty(body) }
  }

  @Patch('contact-properties/:id')
  @RequirePermission('contacts.properties.manage')
  async updateProperty(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updatePropertyRequestSchema)) body: In<typeof updatePropertyRequestSchema>,
  ) {
    return { data: await this.catalog.updateProperty(id, body) }
  }

  @Get('segments')
  @RequirePermission('contacts.read')
  async segments() {
    return { data: await this.catalog.listSegments() }
  }

  @Post('segments')
  @RequirePermission('contacts.write')
  @HttpCode(201)
  async createSegment(
    @Body(pipe(createSegmentRequestSchema)) body: In<typeof createSegmentRequestSchema>,
  ) {
    return { data: await this.catalog.createSegment(body) }
  }

  @Get('segments/:id')
  @RequirePermission('contacts.read')
  async segment(@Param('id', uuidParam) id: string) {
    return { data: await this.catalog.getSegment(id) }
  }

  @Patch('segments/:id')
  @RequirePermission('contacts.write')
  async updateSegment(
    @Param('id', uuidParam) id: string,
    @Body(pipe(updateSegmentRequestSchema)) body: In<typeof updateSegmentRequestSchema>,
  ) {
    return { data: await this.catalog.updateSegment(id, body) }
  }

  @Delete('segments/:id')
  @RequirePermission('contacts.write')
  @HttpCode(204)
  async deleteSegment(@Param('id', uuidParam) id: string): Promise<void> {
    await this.catalog.deleteSegment(id)
  }

  @Post('segments/:id/count')
  @RequirePermission('contacts.read')
  @HttpCode(200)
  async countSegment(@Param('id', uuidParam) id: string) {
    return { data: await this.catalog.countSegment(id) }
  }

  @Get('workspace/consent-settings')
  @RequirePermission('workspace.read')
  async consentSettings() {
    return { data: await this.catalog.consentSettings() }
  }

  @Patch('workspace/consent-settings')
  @RequirePermission('workspace.manage')
  async updateConsentSettings(
    @Body(pipe(consentSettingsSchema.partial())) body: Partial<In<typeof consentSettingsSchema>>,
  ) {
    return { data: await this.catalog.updateConsentSettings(body) }
  }
}

@Controller()
export class ImportExportController {
  constructor(
    private readonly imports: ImportsService,
    private readonly exports: ExportsService,
  ) {}

  @Get('imports')
  @RequirePermission('contacts.import')
  async list() {
    return { data: await this.imports.list() }
  }

  @Post('imports/upload-url')
  @RequirePermission('contacts.import')
  @HttpCode(201)
  async uploadUrl(
    @Body(pipe(importUploadRequestSchema)) body: In<typeof importUploadRequestSchema>,
  ) {
    return { data: await this.imports.uploadUrl(body) }
  }

  @Post('imports')
  @RequirePermission('contacts.import')
  @HttpCode(201)
  async create(@Body(pipe(createImportRequestSchema)) body: In<typeof createImportRequestSchema>) {
    return { data: await this.imports.create(body.fileId) }
  }

  @Get('imports/:id')
  @RequirePermission('contacts.import')
  async get(@Param('id', uuidParam) id: string) {
    return { data: await this.imports.get(id) }
  }

  @Get('imports/:id/preview')
  @RequirePermission('contacts.import')
  async preview(@Param('id', uuidParam) id: string) {
    const job = await this.imports.get(id)
    return { data: { counts: job.counts, rows: job.preview ?? [] } }
  }

  @Patch('imports/:id')
  @RequirePermission('contacts.import')
  async configure(
    @Param('id', uuidParam) id: string,
    @Body(pipe(configureImportRequestSchema)) body: In<typeof configureImportRequestSchema>,
  ) {
    return { data: await this.imports.configure(id, body) }
  }

  @Post('imports/:id/confirm')
  @RequirePermission('contacts.import')
  @HttpCode(200)
  async confirm(@Param('id', uuidParam) id: string) {
    return { data: await this.imports.confirm(id) }
  }

  @Post('imports/:id/cancel')
  @RequirePermission('contacts.import')
  @HttpCode(200)
  async cancel(@Param('id', uuidParam) id: string) {
    return { data: await this.imports.cancel(id) }
  }

  @Get('imports/:id/error-report')
  @RequirePermission('contacts.import')
  async errorReport(@Param('id', uuidParam) id: string) {
    return { data: await this.imports.errorReportUrl(id) }
  }

  @Post('exports')
  @RequirePermission('contacts.export')
  @HttpCode(202)
  async createExport(
    @Body(pipe(createExportRequestSchema)) body: In<typeof createExportRequestSchema>,
  ) {
    return { data: await this.exports.create(body.filter, body.q) }
  }

  @Get('exports/:id')
  @RequirePermission('contacts.export')
  async getExport(@Param('id', uuidParam) id: string) {
    return { data: await this.exports.get(id) }
  }
}
