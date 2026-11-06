// No 'reflect-metadata' import on purpose: a direct load of /studio reads this
// file in the browser before anything else installed the polyfill, and
// class-transformer's @Type calls Reflect.getMetadata as the class is defined
describe('studio.clip.dto', () => {
  it('loads before anything installed reflect-metadata', () => {
    expect((Reflect as any).getMetadata).toBeUndefined();
    let dto: any;
    expect(() => {
      jest.isolateModules(() => {
        dto = require('@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto');
      });
    }).not.toThrow();
    expect(dto.STUDIO_MAX_SECONDS).toBe(90);
  });
});
