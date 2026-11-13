import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { AirportsController } from './airports.controller';

describe('AirportsController', () => {
  const airports = [{ iata_code: 'CAI', name: 'Cairo International Airport' }];
  const toArray = jest.fn<() => Promise<typeof airports>>();
  const limit = jest.fn().mockReturnValue({ toArray });
  const skip = jest.fn().mockReturnValue({ limit });
  const sort = jest.fn().mockReturnValue({ skip });
  const find = jest.fn().mockReturnValue({ sort });
  const countDocuments = jest.fn<() => Promise<number>>();
  const collection = { find, countDocuments };
  const connection = {
    db: { collection: jest.fn().mockReturnValue(collection) },
  } as unknown as Connection;
  const controller = new AirportsController(connection);

  beforeEach(() => {
    jest.clearAllMocks();
    toArray.mockResolvedValue(airports);
    countDocuments.mockResolvedValue(21);
    limit.mockReturnValue({ toArray });
    skip.mockReturnValue({ limit });
    sort.mockReturnValue({ skip });
    find.mockReturnValue({ sort });
    (connection.db!.collection as jest.Mock).mockReturnValue(collection);
  });

  it('returns a stable paginated, country-filtered result', async () => {
    await expect(controller.search('Cairo', 'eg', '2', '10')).resolves.toEqual({
      airports,
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        country_code: 'EG',
        $or: expect.arrayContaining([
          { iata_code: { $regex: '^Cairo', $options: 'i' } },
        ]),
      }),
      { projection: { _id: 0 } },
    );
    expect(skip).toHaveBeenCalledWith(10);
    expect(limit).toHaveBeenCalledWith(10);
  });

  it('escapes search text so user input cannot inject a regular expression', async () => {
    await controller.search('.*', '', '1', '20');
    expect(find).toHaveBeenCalledWith(
      {
        $or: [
          { iata_code: { $regex: '^\\.\\*', $options: 'i' } },
          { name: { $regex: '\\.\\*', $options: 'i' } },
        ],
      },
      { projection: { _id: 0 } },
    );
  });

  it.each([
    ['0', '20', '', ''],
    ['1', '101', '', ''],
    ['1.5', '20', '', ''],
    ['1', '20', '', 'USA'],
    ['1', '20', 'x'.repeat(101), ''],
  ])(
    'rejects invalid pagination or filters',
    async (page, limit, query, country) => {
      await expect(
        controller.search(query, country, page, limit),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(find).not.toHaveBeenCalled();
    },
  );
});
