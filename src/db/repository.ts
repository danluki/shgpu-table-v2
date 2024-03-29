import { Between, DataSource, In, QueryFailedError } from "typeorm";
import { AppDataSource } from ".";
import { Faculty as FacultyEntity } from "./entities/Faculty";
import { Group } from "./entities/Group";
import { Pair as PairEntity } from "./entities/Pair";
import { FacultyId, Pair, PublicFaculty } from "../typings";
import { DatabaseError } from "pg";
import dayjs from "dayjs";
import { Services, Subscriber } from "./entities/Subscriber";
class Repository {
  private typeorm: DataSource;

  public async connect() {
    this.typeorm = await AppDataSource.initialize();
    await this.typeorm.runMigrations();
  }

  public async getFaculty(id: number): Promise<FacultyEntity | null> {
    const faculty = await this.typeorm.getRepository(FacultyEntity).findOneBy({
      id: id,
    });
    return faculty;
  }

  public async getFaculties(): Promise<PublicFaculty[]> {
    const faculties = await this.typeorm.getRepository(FacultyEntity).find();

    return faculties;
  }

  public async getSubscribers(faculty: FacultyId): Promise<Subscriber[]> {
    const subs = await this.typeorm.getRepository(Subscriber).findBy({
      facultyId: faculty,
    });

    return subs;
  }

  public async getServiceSubscribers(service: Services): Promise<Subscriber[]> {
    const subs = await this.typeorm.getRepository(Subscriber).findBy({
      service: service,
    });

    return subs;
  }

  public async getVkSubscriber(chatId: string): Promise<Subscriber> {
    const sub = await this.typeorm.getRepository(Subscriber).findOneBy({
      chatId: chatId,
      service: Services.VK,
    });

    return sub;
  }

  public async getTelegramSubscriber(chatId: string): Promise<Subscriber> {
    const sub = await this.typeorm.getRepository(Subscriber).findOneBy({
      chatId: chatId,
      service: Services.TELEGRAM,
    });

    return sub;
  }

  public async findPairs(
    filter: string,
    begin: Date,
    end: Date,
  ): Promise<Pair[]> {
    let pairs = [];

    if (!/\d/.test(filter)) {
      pairs = await this.getPairsByInstructor(filter, begin, end);
    } else {
      pairs = await this.getPairsByDates(filter, begin, end);
    }

    const dtoPairs: Pair[] = [];
    pairs.forEach((pair: any) => {
      dtoPairs.push({
        ...pair,
        date: new Date(pair.date).toISOString(),
      });
    });

    return dtoPairs;
  }

  //TODO: test how it works.
  public async getLector(name: string): Promise<string> {
    const lector = await this.typeorm
      .getRepository(PairEntity)
      .query(
        `SELECT regexp_like(name, '.*${name}\\s.*', 'i') AS matched, pairs.* FROM pairs LIMIT 1;`,
      );

    return lector;
  }

  public async getPairsByInstructor(
    instructor: string,
    begin: Date,
    end: Date,
  ): Promise<Pair[]> {
    const pairs = await this.typeorm
      .getRepository(PairEntity)
      .query(
        `SELECT * FROM pairs WHERE regexp_like(name, '.*${instructor}\\s.*', 'i') AND date >= '${begin.toISOString()}' AND date <= '${end.toISOString()}' ORDER BY date ASC;`,
      );
    const dtoPairs: Pair[] = [];
    pairs.forEach((pair: any) => {
      dtoPairs.push({
        ...pair,
        date: new Date(pair.date).toISOString(),
      });
    });
    return dtoPairs;
  }

  public async getPairsByDays(
    groupName: string,
    offset: number,
    count: number,
  ) {
    const currentDate = dayjs();
    const startDate = currentDate.add(offset);
    const endDate = currentDate.add(offset + count - 1);

    const pairs = await this.typeorm.getRepository(PairEntity).find({
      order: {
        date: "ASC",
      },
      select: {
        name: true,
        number: true,
        day: true,
        groupName: true,
        date: true,
      },
      where: {
        groupName: groupName,
        date: Between(startDate.toDate(), endDate.toDate()),
      },
    });

    const dtoPairs: Pair[] = [];
    pairs.forEach((pair) => {
      dtoPairs.push({
        ...pair,
        date: new Date(pair.date).toISOString(),
      });
    });
    return dtoPairs;
  }

  public async getGroup(groupName: string): Promise<Group | null> {
    const group = await this.typeorm.getRepository(Group).findOne({
      where: { name: groupName },
      relations: {
        faculty: true,
      },
    });

    return group;
  }

  public async getPairsByDates(
    groupName: string,
    begin: Date,
    end: Date,
  ): Promise<Pair[]> {
    const pairs = await this.typeorm.getRepository(PairEntity).find({
      order: {
        date: "ASC",
        number: "ASC",
      },
      select: {
        name: true,
        number: true,
        day: true,
        groupName: true,
        date: true,
      },
      where: {
        groupName: groupName,
        date: Between(begin, end),
      },
      // relations: {
      //   faculty: true,
      // },
    });
    const dtoPairs: Pair[] = [];
    pairs.forEach((pair) => {
      dtoPairs.push({
        ...pair,
        date: new Date(pair.date).toISOString(),
      });
    });
    return dtoPairs;
  }

  public async addPair(pair: Pair) {
    const dbPair = new PairEntity();
    try {
      const faculty = await this.typeorm.getRepository(FacultyEntity).findOne({
        where: {
          id: pair.faculty.id,
        },
      });

      if (!faculty) {
        throw new Error("Can't find faculty for pair");
      }

      dbPair.name = pair.name;
      dbPair.number = pair.number;
      dbPair.date = new Date(pair.date);
      dbPair.day = pair.day;
      dbPair.faculty = faculty;
      dbPair.groupName = pair.groupName;
      await this.typeorm.getRepository(PairEntity).save(dbPair);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const e = err.driverError as DatabaseError;
        if (e.code === "23505") {
          return;
        }
      }
      throw err;
    }
  }

  public async removePairs(beginDate: Date, endDate: Date, faculty: FacultyId) {
    const ds = this.typeorm.getRepository(PairEntity);
    await ds
      .createQueryBuilder("pairs")
      .delete()
      .from(PairEntity)
      .where(
        "facultyId = :facultyId AND date >= :beginDate AND date <= :endDate",
        { facultyId: faculty, beginDate, endDate },
      )
      .execute();
  }
}

export default new Repository();
