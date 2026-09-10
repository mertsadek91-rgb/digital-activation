import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AddToCart,
  type Cart,
  type CartQuery,
  addToCartSchema,
  applyCouponSchema,
  cartQuerySchema,
  updateCartLineSchema,
} from '@da/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.js';

import { CartService } from './cart.service.js';

const CART_COOKIE = 'da_cart';
/** The cart outlives the browser session; the reservation inside it does not. */
const CART_COOKIE_MAX_AGE = 30 * 24 * 3600;

/**
 * `@fastify/cookie` declares `cookies` on FastifyRequest already, so redeclaring
 * it here conflicts rather than helps — the auth guard reads it straight off
 * the request for the same reason.
 */
type CartRequest = FastifyRequest;

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  /**
   * The cart token lives in an httpOnly cookie.
   *
   * It is a bearer token for somebody's cart: whoever holds it can read the
   * lines, the email once checkout captures one, and change the contents. Out
   * of JavaScript's reach costs nothing here — no client code needs to read it
   * — and SameSite=strict keeps another site from driving the cart.
   */
  private setToken(reply: FastifyReply, token: string): void {
    void reply.setCookie(CART_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: CART_COOKIE_MAX_AGE,
    });
  }

  private token(request: CartRequest): string | undefined {
    return request.cookies?.[CART_COOKIE];
  }

  @Get()
  @ApiOperation({ summary: 'The current cart, creating an empty one if needed' })
  async get(
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: CartRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const cart = await this.cart.resolve(this.token(request), query);
    this.setToken(reply, cart.token);
    return this.cart.render(cart.token, query, []);
  }

  // A shopper clicks add a handful of times; a script clicks it thousands.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('items')
  @ApiOperation({ summary: 'Add a variant, taking a timed stock reservation' })
  async add(
    @Body(new ZodPipe(addToCartSchema)) body: AddToCart,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: CartRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const cart = await this.cart.add(this.token(request), body, query);
    this.setToken(reply, cart.token);
    return cart;
  }

  @Patch('items/:variantId')
  @ApiOperation({ summary: 'Set a line quantity; zero removes the line' })
  async setQty(
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(updateCartLineSchema)) body: z.infer<typeof updateCartLineSchema>,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: CartRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const token = this.token(request);
    const cart = await this.cart.setQty(token ?? '', variantId, body.qty, query);
    this.setToken(reply, cart.token);
    return cart;
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the cart and release its reservations' })
  async clear(
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: CartRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const cart = await this.cart.clear(this.token(request) ?? '', query);
    this.setToken(reply, cart.token);
    return cart;
  }

  // Coupon codes are guessable, so this is the one cart route worth rate
  // limiting hard: without it the endpoint is a free oracle for brute-forcing
  // whatever discount codes exist.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('coupon')
  @ApiOperation({ summary: 'Apply a coupon, or return why it was refused' })
  async applyCoupon(
    @Body(new ZodPipe(applyCouponSchema)) body: z.infer<typeof applyCouponSchema>,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: CartRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const cart = await this.cart.applyCoupon(this.token(request) ?? '', body.code, query);
    this.setToken(reply, cart.token);
    return cart;
  }

  @Delete('coupon')
  @ApiOperation({ summary: 'Detach the coupon' })
  async removeCoupon(
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: CartRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Cart> {
    const cart = await this.cart.removeCoupon(this.token(request) ?? '', query);
    this.setToken(reply, cart.token);
    return cart;
  }
}
