import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_METHOD,
  DELIVERY_SLA_SECONDS,
  LICENSE_PERIOD,
  classifyFulfillment,
  classifyKind,
  classifyPlatform,
  refineActivationFromTitle,
  requiresActivationEmail,
} from './normalize.js';
import { ActivationMethod, LicensePeriodUnit, Platform, ProductKind } from '../../src/index.js';

/**
 * Guards the import decisions that turn into stock levels and checkout fields.
 *
 * Both of these cost money when they are wrong and say nothing when they are.
 * A row classified away from FROM_STOCK drops the units the owner is actually
 * holding — the catalogue reads "out of stock" for something sitting on the
 * shelf. A row that needs the customer's own email address but is not marked as
 * needing it produces a key nobody can use, after the money has been taken.
 */
describe('classifyFulfillment', () => {
  it('lets _manage_stock win over the activation wording — the bug that dropped fifteen Office 365 units', () => {
    // Classifying by activation style first filed the ready-account rows as
    // manual setup, because their activation reads "a ready subscription", and
    // the fifteen accounts the owner held stopped being sellable. How a licence
    // is used describes it; having fifteen on the shelf is a fact about it.
    expect(
      classifyFulfillment({
        _manage_stock: 'yes',
        activation_method: 'أشتراك جاهز للأستخدام عن طريق اسم مستخدم وكلمة مرور',
      }),
    ).toBe('FROM_STOCK');
  });

  it('lets _manage_stock win over every other manual-setup marker as well', () => {
    for (const activation of [
      'حساب جاهز (Email+Password) + Key + بانل',
      'حساب Canva Edu جاهز',
      'دعوة لحساب Canva Pro',
      'بانل تفعيل احترافي (Bind Key Panel)',
      'تفعيل يدوي (Manual Activation)',
    ]) {
      expect(classifyFulfillment({ _manage_stock: 'yes', activation_method: activation })).toBe(
        'FROM_STOCK',
      );
    }
  });

  it('lets _manage_stock win over a delivery that requires an installation', () => {
    expect(
      classifyFulfillment({ _manage_stock: 'yes', delivery: 'تنصيب وتفعيل الإضافة على موقعك' }),
    ).toBe('FROM_STOCK');
  });

  it('reads a ready account with stock tracking off as manual setup', () => {
    expect(
      classifyFulfillment({
        _manage_stock: 'no',
        activation_method: 'حساب جاهز (Email+Password) + Key + بانل',
      }),
    ).toBe('MANUAL_SETUP');
  });

  it('reads an installation on the customer site as manual setup', () => {
    expect(classifyFulfillment({ delivery: 'تنصيب وتفعيل الإضافة على موقعك' })).toBe(
      'MANUAL_SETUP',
    );
  });

  it('defaults to on-demand, which is what 91 of the 101 legacy rows really are', () => {
    // Treating every row as stock-backed is what made 67 products read "out of
    // stock" when they were never out of stock.
    expect(classifyFulfillment({})).toBe('ON_DEMAND');
    expect(classifyFulfillment({ activation_method: 'كود تفعيل سيريال' })).toBe('ON_DEMAND');
  });

  it('treats a missing _manage_stock as "no" rather than as stock in hand', () => {
    expect(classifyFulfillment({ activation_method: 'حساب جاهز' })).toBe('MANUAL_SETUP');
  });

  it('only accepts the exact WooCommerce value "yes" as stock tracking', () => {
    for (const value of ['', 'no', 'YES', '1', 'true']) {
      expect(
        classifyFulfillment({
          _manage_stock: value,
          activation_method: 'حساب جاهز (Email+Password) + Key + بانل',
        }),
      ).toBe('MANUAL_SETUP');
    }
  });
});

describe('requiresActivationEmail', () => {
  it('asks for an address when the licence is bound to one the customer supplies', () => {
    for (const activation of [
      'يتم التفعيل على الايميل الخاص بكم',
      'يتم التفعيل على الايميل الذي تم تزويدنا به',
      'Bind Key - مرتبط بحساب مايكروسوفت',
      'كود تفعيل مرتبط بحساب مايكروسوفت',
      'دعوة لحساب Canva Pro',
    ]) {
      expect(requiresActivationEmail({ activation_method: activation })).toBe(true);
    }
  });

  it('reads the delivery field too, not only the activation field', () => {
    expect(
      requiresActivationEmail({ delivery: 'يتم التسليم على الايميل الذي يتم تزويدنا به' }),
    ).toBe(true);
  });

  it('does not ask for an address for a ready account, which the seller creates', () => {
    // Asking here would add a checkout field with no purpose on fourteen
    // products — and a field with no purpose is a field people get wrong.
    for (const activation of [
      'حساب جاهز (Email+Password) + Key + بانل',
      'أشتراك جاهز للأستخدام عن طريق اسم مستخدم وكلمة مرور',
      'حساب Canva Edu جاهز',
    ]) {
      expect(requiresActivationEmail({ activation_method: activation })).toBe(false);
    }
  });

  it('does not ask for an address for a plain retail key', () => {
    expect(requiresActivationEmail({ activation_method: 'كود تفعيل سيريال' })).toBe(false);
    expect(requiresActivationEmail({})).toBe(false);
  });

  it('is independent of fulfillment: a Canva Pro invite is manual setup and needs an address', () => {
    const meta = { activation_method: 'دعوة لحساب Canva Pro' };

    expect(classifyFulfillment(meta)).toBe('MANUAL_SETUP');
    expect(requiresActivationEmail(meta)).toBe(true);
  });
});

describe('refineActivationFromTitle', () => {
  it('lets an explicit title override an activation field filled in by habit', () => {
    // Two Office 2016 rows carry the same activation_method while their titles
    // say Phone and Online, and they are priced $9.95 and $44.45 apart.
    expect(
      refineActivationFromTitle(
        'Office 2016 Pro Plus Phone Activation',
        ActivationMethod.RETAIL_ONLINE,
      ),
    ).toBe(ActivationMethod.RETAIL_PHONE);
    expect(
      refineActivationFromTitle(
        'Office 2016 Pro Plus Online Activation',
        ActivationMethod.RETAIL_PHONE,
      ),
    ).toBe(ActivationMethod.RETAIL_ONLINE);
  });

  it('recognises the Arabic phrasing of phone activation as well as the English', () => {
    expect(
      refineActivationFromTitle('أوفيس 2016 تفعيل عبر الهاتف', ActivationMethod.RETAIL_ONLINE),
    ).toBe(ActivationMethod.RETAIL_PHONE);
  });

  it('keeps the field value when the title says nothing about activation', () => {
    expect(refineActivationFromTitle('Windows 11 Pro', ActivationMethod.CAL_KEY)).toBe(
      ActivationMethod.CAL_KEY,
    );
  });

  it('prefers redeem code over the other title hints, because it is the most specific', () => {
    expect(
      refineActivationFromTitle('Adobe Redeem Code Manual Setup', ActivationMethod.RETAIL_ONLINE),
    ).toBe(ActivationMethod.REDEEM_CODE);
  });
});

describe('the normalisation tables', () => {
  it('never maps two spellings of one year to different terms', () => {
    for (const spelling of ['سنة كاملة', 'سنة واحدة', 'سنة واحد', '12 شهر', 'سنة كاملة (12 شهر)']) {
      expect(LICENSE_PERIOD[spelling]).toEqual({ value: 1, unit: LicensePeriodUnit.YEAR });
    }
  });

  it('gives a lifetime licence no numeric value, so nothing can compute an expiry', () => {
    expect(LICENSE_PERIOD['مدى الحياة']).toEqual({ value: null, unit: LicensePeriodUnit.LIFETIME });
  });

  it('has no entry for an unrecognised value, so the import reports it instead of defaulting', () => {
    // A silent default here bakes a wrong licence term into a product page and
    // the customer finds out after paying.
    expect(LICENSE_PERIOD['سنتين ونصف']).toBeUndefined();
    expect(ACTIVATION_METHOD['طريقة غير معروفة']).toBeUndefined();
    expect(DELIVERY_SLA_SECONDS['وقت غير معروف']).toBeUndefined();
  });

  it('takes an instant-delivery promise at its word only where it is one', () => {
    expect(DELIVERY_SLA_SECONDS['تسليم فوري عبر البريد الإلكتروني']).toBe(60);
    expect(DELIVERY_SLA_SECONDS['خلال 6 ساعات']).toBe(6 * 3600);
    expect(DELIVERY_SLA_SECONDS['تنصيب وتفعيل الإضافة على موقعك']).toBe(24 * 3600);
  });

  it('keeps phone activation distinct from online, because it generates support tickets', () => {
    expect(ACTIVATION_METHOD['MAK Key - تفعيل عبر الهاتف (Phone Activation)']).toBe(
      ActivationMethod.VOLUME_MAK,
    );
    expect(ACTIVATION_METHOD['كود تفعيل عبر الهاتف']).toBe(ActivationMethod.RETAIL_PHONE);
    expect(ACTIVATION_METHOD['كود تفعيل سيريال']).toBe(ActivationMethod.RETAIL_ONLINE);
  });
});

describe('classifyKind', () => {
  it('reads a panel before an account, because a panel row also says "account"', () => {
    expect(classifyKind('بانل تفعيل احترافي - Activation Panel')).toBe(ProductKind.PANEL);
  });

  it('reads an account, a bundle and a service from their own words', () => {
    expect(classifyKind('حساب Canva Pro جاهز')).toBe(ProductKind.ACCOUNT);
    expect(classifyKind('الباقة الأساسية ويندوز 11 برو + أوفيس 365')).toBe(ProductKind.BUNDLE);
    expect(classifyKind('خدمة كتابة المحتوى')).toBe(ProductKind.SERVICE);
  });

  it('falls back to a key, which is what most of this catalogue sells', () => {
    expect(classifyKind('Windows 11 Pro مفتاح تفعيل')).toBe(ProductKind.KEY);
  });
});

describe('classifyPlatform', () => {
  it('lets a Mac or cross-platform hint beat the Windows default', () => {
    expect(classifyPlatform('Office 2021 for Mac')).toBe(Platform.MAC);
    expect(classifyPlatform('Parallels Linux')).toBe(Platform.CROSS_PLATFORM);
    expect(classifyPlatform('Adobe Creative Cloud')).toBe(Platform.CROSS_PLATFORM);
  });

  it('defaults to Windows only because 90% of this catalogue is Windows software', () => {
    expect(classifyPlatform('ESET Internet Security')).toBe(Platform.WINDOWS);
  });
});
