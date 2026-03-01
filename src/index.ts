import Fastify from 'fastify';
import { InMemoryBookingStorage } from './storage/inMemoryBookingStorage';
import { LoggingTelephonyProvider } from './providers/loggingTelephonyProvider';
import { ConsoleNotificationProvider } from './providers/consoleNotificationProvider';
import { BookingService } from './services/bookingService';
import { MockLlmProvider } from './services/mockLlmProvider';
import type { TimeWindow } from './core/models';

const app = Fastify({ logger: true });

// Core single-tenant wiring for DynaTire PoC
const TENANT_ID = 'dynatire-tenant';
const RESOURCE_ID = 'dynatire-resource';
const OWNER_PHONE = '+10000000000'; // placeholder; replace with real owner number

const storage = new InMemoryBookingStorage();
const telephony = new LoggingTelephonyProvider();
const notifications = new ConsoleNotificationProvider(telephony, OWNER_PHONE);
const bookingService = new BookingService(storage, notifications);
const llm = new MockLlmProvider();

app.get('/health', async () => ({ status: 'ok' }));

// Simple text-based chat endpoint for PoC
app.post('/chat', async (req, reply) => {
  const body = req.body as {
    phone: string;
    name?: string;
    address: string;
    message: string;
  };

  const now = new Date();
  const window: TimeWindow = {
    from: now,
    to: new Date(now.getTime() + 2 * 60 * 60 * 1000), // next 2 hours
  };

  const appointment = await bookingService.bookSimpleAppointment({
    tenantId: TENANT_ID,
    resourceId: RESOURCE_ID,
    customerPhone: body.phone,
    customerName: body.name,
    address: body.address,
    description: body.message,
    window,
  });

  const aiReply = await llm.runSecretaryTurn({
    tenantId: TENANT_ID,
    customerPhone: body.phone,
    message: body.message,
  });

  return reply.send({
    reply: aiReply.reply,
    appointment,
  });
});

const port = Number(process.env.PORT || 3000);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Server listening on port ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
