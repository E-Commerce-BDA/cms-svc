import { Injectable, PipeTransform } from '@nestjs/common';
import type { NavSettings } from '@ecom/contracts';
import { normalizeNavSettings } from './nav-validation.js';

/** Admin write boundary: one parser for the contract shape and href safety. */
@Injectable()
export class NavigationValidationPipe implements PipeTransform {
  transform(value: unknown): NavSettings {
    return normalizeNavSettings(value);
  }
}
